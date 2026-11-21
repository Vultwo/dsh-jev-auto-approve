import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { classify, pingJev } from './classify.js';

export const name = 'jev-auto-approve';

function expandHome(path) {
  if (typeof path !== 'string' || path.length === 0) return path;
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return `${homedir()}/${path.slice(2)}`;
  return path;
}

function keyFromText(raw) {
  for (const line of String(raw).split(/\r?\n/)) {
    const value = line.trim();
    if (value.length === 0 || value.startsWith('#')) continue;
    return value;
  }
  return undefined;
}


function isLoopback(req) {
  const address = req.socket?.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function sendJson(res, status, value, head = false) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(head ? undefined : JSON.stringify(value));
}

function score(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readToolArgs(session, callId) {
  if (callId === undefined) return undefined;
  try {
    const events = session.snapshotEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type !== 'tool/call') continue;
      if (String(event.data?.callId) !== String(callId)) continue;
      const raw = event.data?.arguments;
      if (typeof raw !== 'string') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
  } catch {
    // The session log is best-effort evidence; a read failure falls back to the reason text.
  }
  return undefined;
}


const READ_ONLY_PLUGIN_MANAGER_ACTIONS = new Set(['list_plugins', 'list_bundles']);

function isReadOnlyPluginManagerCall(toolName, args) {
  if (toolName !== 'plugin_manager') return false;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false;
  return READ_ONLY_PLUGIN_MANAGER_ACTIONS.has(args.action);
}

function textBlocksOf(data) {
  const content = Array.isArray(data?.content)
    ? data.content
    : Array.isArray(data?.message?.content)
      ? data.message.content
      : [];
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

// The harness injects context (time samples, runtime snapshots, skill
// catalogues) as `user/message` events too, and tags each one with a
// `source.kind`. Only `kind: "user"` came from the person typing.
function isHumanMessage(data) {
  const kind = data?.source?.kind;
  return kind === undefined || kind === 'user';
}

/**
 * The user's own instruction, scanned backwards from the tool call that is
 * waiting for approval. Injected context is skipped, and nothing after the
 * tool call counts, so a later message cannot retroactively authorize it.
 */
export function readLastUserMessage(session, callId) {
  try {
    const events = session.snapshotEvents();
    let passToolCall = callId === undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!passToolCall) {
        if (event.type === 'tool/call' && String(event.data?.callId) === String(callId)) {
          passToolCall = true;
        }
        continue;
      }
      if (event.type !== 'user/message') continue;
      const data = event.data ?? {};
      if (!isHumanMessage(data)) continue;
      const text = textBlocksOf(data);
      if (text.length > 0) return text.slice(0, 1200);
    }
  } catch {
    // Optional context; omit it when the session surface cannot be read.
  }
  return undefined;
}

/**
 * The sandbox contract the harness declared for this session, taken from the
 * most recent runtime-context snapshot. It tells Jev what is already permitted
 * without approval, which is the difference between reviewing an escalation
 * and reviewing a routine call.
 */
export function readSandboxPolicy(session) {
  const wanted = new Set(['sandbox:policy', 'approval:policy']);
  try {
    const events = session.snapshotEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type !== 'user/message') continue;
      const source = event.data?.source;
      if (source?.kind !== 'runtime-context') continue;
      const sections = Array.isArray(source.sections) ? source.sections : [];
      const lines = sections
        .filter((section) => wanted.has(section?.name) && typeof section?.text === 'string')
        .map((section) => section.text);
      if (lines.length > 0) return lines.join('\n').slice(0, 800);
    }
  } catch {
    // Optional context; omit it when the session surface cannot be read.
  }
  return undefined;
}

function readCwd(ctx, session) {
  try {
    return ctx.get('workingDirectory')?.get(session);
  } catch {
    return undefined;
  }
}

/**
 * Register the approval answerer and the `/jev-auto` command.
 * The plugin answers only approval requests; it never changes the session
 * permission preset or the sandbox mode.
 */
export function apply(ctx, config = {}) {
  let runtimeEnabled = config.enabled !== false;
  let runtimeMode = config.mode === 'shadow' ? 'shadow' : 'enforce';
  const stats = {
    startedAt: Date.now(),
    reviews: 0,
    allowed: 0,
    asked: 0,
    errors: 0,
    noKey: 0,
    testCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    last: null,
  };
  let warnedNoKey = false;

  async function resolveKey() {
    const direct = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (direct.length > 0) return { key: direct, source: 'config' };
    const envName = config.apiKeyEnv || 'TYPESAFE_API_KEY';
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(envName);
        if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) {
          return { key: hit.value, source: `credentials:${envName}` };
        }
      } catch {
        // A missing credential record is the normal first-run state.
      }
    }
    const ambient = process.env[envName];
    if (typeof ambient === 'string' && ambient.trim().length > 0) {
      return { key: ambient.trim(), source: `env:${envName}` };
    }
    const file = expandHome(config.apiKeyFile || '~/.dsh/jev-api-key');
    try {
      const key = keyFromText(await readFile(file, 'utf8'));
      if (key !== undefined) return { key, source: `file:${file}` };
    } catch {
      // A missing key file is the normal first-run state.
    }
    return undefined;
  }

  async function appendDecision(entry) {
    try {
      const file = expandHome(config.logFile || '~/.dsh/jev-auto-approve.jsonl');
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
    } catch (error) {
      ctx.logger.warn(`jev-auto-approve: decision log write failed: ${String(error)}`);
    }
  }

  const handler = async (req, next) => {
    if (!runtimeEnabled) return next();
    if (req.signal?.aborted) return 'cancelled';

    const keyInfo = await resolveKey();
    if (keyInfo === undefined) {
      if (!warnedNoKey) {
        ctx.logger.warn('jev-auto-approve: no TypeSafe key configured; approval prompts stay with the user');
        warnedNoKey = true;
      }
      stats.noKey += 1;
      stats.last = { outcome: 'no-key', tool: req.toolName, reason: 'no TypeSafe key configured' };
      await appendDecision({ outcome: 'no-key', tool: req.toolName, callId: req.callId ?? null });
      return next();
    }

    const session = req.agent.session;
    const args = readToolArgs(session, req.callId);
    if (config.allowReadOnlyPluginManager !== false && isReadOnlyPluginManagerCall(req.toolName, args)) {
      stats.reviews += 1;
      stats.allowed += 1;
      stats.last = {
        outcome: 'allowed-readonly',
        tool: req.toolName,
        reason: 'read-only plugin_manager action',
        at: Date.now(),
      };
      await appendDecision({
        outcome: 'allowed-readonly',
        tool: req.toolName,
        callId: req.callId ?? null,
        sessionId: String(session.id),
        reviewReason: 'read-only plugin_manager action',
        keySource: keyInfo.source,
      });
      return 'allowed-once';
    }

    const state = {
      tool: req.toolName,
      reason: req.reason ?? null,
      arguments:
        args === undefined
          ? null
          : typeof args === 'string'
            ? args.slice(0, 6000)
            : JSON.stringify(args).slice(0, 6000),
      cwd: readCwd(ctx, session) ?? null,
      sandboxPolicy: readSandboxPolicy(session) ?? null,
      userMessage: config.includeUserMessage === false ? null : (readLastUserMessage(session, req.callId) ?? null),
    };

    let result;
    try {
      result = await classify({
        endpoint: config.baseURL || 'https://api.typesafe.ai/v1/systemone',
        model: config.model || 'jev-latest',
        key: keyInfo.key,
        state,
        config,
        signal: req.signal,
      });
    } catch (error) {
      if (req.signal?.aborted) return 'cancelled';
      const message = error instanceof Error ? error.message : String(error);
      stats.reviews += 1;
      stats.asked += 1;
      stats.errors += 1;
      stats.last = { outcome: 'error', tool: req.toolName, reason: message };
      await appendDecision({
        outcome: 'error',
        tool: req.toolName,
        callId: req.callId ?? null,
        sessionId: String(session.id),
        error: message,
      });
      ctx.logger.warn(`jev-auto-approve: review failed; leaving this approval to the user: ${message}`);
      return next();
    }

    stats.reviews += 1;
    const wouldAllow = result.action === 'allow';
    const allowed = wouldAllow && runtimeMode === 'enforce';
    if (allowed) stats.allowed += 1;
    else stats.asked += 1;
    stats.inputTokens += result.usage?.inputTokens ?? 0;
    stats.outputTokens += result.usage?.outputTokens ?? 0;
    stats.costUsd += result.usage?.costUsd ?? 0;
    stats.last = {
      outcome: allowed ? 'allowed' : wouldAllow ? 'would-allow' : 'ask',
      tool: req.toolName,
      reason: result.reason,
      scores: result.scores,
      at: Date.now(),
    };
    await appendDecision({
      outcome: allowed ? 'allowed' : wouldAllow ? 'would-allow' : 'ask',
      tool: req.toolName,
      callId: req.callId ?? null,
      sessionId: String(session.id),
      mode: runtimeMode,
      scores: result.scores,
      latencyMs: result.latencyMs,
      usage: result.usage,
      reviewReason: result.reason,
      keySource: keyInfo.source,
      cwd: state.cwd,
    });
    if (allowed) return 'allowed-once';
    return next();
  };

  ctx.effect(function* () {
    yield ctx.on('approval/request', handler, { prepend: true });
  }, 'jev-auto-approve approval answerer');

  ctx.inject(['commands'], (scope) => {
    scope.effect(function* () {
      yield scope.commands.register({
      definitionId: 'dsh-jev-auto-approve',
      name: 'jev-auto',
      description: 'Show or test Jev auto-approval',
      handler: async (invocation) => {
        const action = invocation.rawInput.trim().toLowerCase();
        const keyInfo = await resolveKey();
        if (action === 'test') {
          if (keyInfo === undefined) {
            return {
              kind: 'error',
              text:
                'No TypeSafe key found. Open Plugins -> Jev auto-approve -> Configure, or create ~/.dsh/jev-api-key.',
            };
          }
          const ping = await pingJev({
            endpoint: config.baseURL || 'https://api.typesafe.ai/v1/systemone',
            model: config.model || 'jev-latest',
            key: keyInfo.key,
            timeoutMs: score(config.timeoutMs, 4000),
            signal: invocation.signal,
          });
          if (ping.ok) {
            return {
              kind: 'success',
              text: `Jev connection OK (${ping.model ?? config.model ?? 'jev-latest'}, ${ping.latencyMs} ms). Key source: ${keyInfo.source}.`,
            };
          }
          return {
            kind: 'error',
            text: `Jev connection failed: ${ping.error}. Key source: ${keyInfo.source}.`,
          };
        }
        if (action === 'on' || action === 'off') {
          runtimeEnabled = action === 'on';
          return { kind: 'success', text: `Jev Auto-Approve is now ${runtimeEnabled ? 'enabled' : 'disabled'} for this process.` };
        }
        if (action === 'shadow' || action === 'enforce') {
          runtimeMode = action;
          return { kind: 'success', text: `Jev Auto-Approve mode is now ${runtimeMode} for this process.` };
        }
        const lines = [
          `Jev Auto-Approve: ${runtimeEnabled ? 'enabled' : 'disabled'} (${runtimeMode})`,
          `Endpoint: ${config.baseURL || 'https://api.typesafe.ai/v1/systemone'} - model ${config.model || 'jev-latest'}`,
          `Key: ${keyInfo === undefined ? 'missing' : keyInfo.source}`,
          `Thresholds: destructive <= ${score(config.destructiveMax, 0.15).toFixed(2)}, exfiltration <= ${score(config.exfiltrationMax, 0.1).toFixed(2)}, security_mode <= ${score(config.securityModeMax, 0.2).toFixed(2)}, authorized >= ${score(config.authorizedThreshold, 0.8).toFixed(2)}`,
          `Reviews: ${stats.reviews} - auto-approved: ${stats.allowed} - asked: ${stats.asked}`,
          `Tokens: ${stats.inputTokens} input, ${stats.outputTokens} output - cost $${stats.costUsd.toFixed(6)}`,
          stats.last === null ? 'Last: none' : `Last: ${stats.last.outcome} ${stats.last.tool}${stats.last.reason ? ` (${stats.last.reason})` : ''}`,
          `Log: ${config.logFile || '~/.dsh/jev-auto-approve.jsonl'}`,
        ];
        if (keyInfo === undefined) {
          lines.push('Set a key in Plugins -> Jev Auto-Approve, then run /jev-auto test.');
        }
        return { kind: 'success', text: lines.join('\n') };
      },
      });
    }, 'jev-auto-approve command');
  });


  async function statsSnapshot() {
    const keyInfo = await resolveKey();
    return {
      enabled: runtimeEnabled,
      mode: runtimeMode,
      endpoint: config.baseURL || 'https://api.typesafe.ai/v1/systemone',
      model: config.model || 'jev-latest',
      keyConfigured: keyInfo !== undefined,
      keySource: keyInfo === undefined ? null : keyInfo.source,
      startedAt: stats.startedAt,
      reviews: stats.reviews,
      allowed: stats.allowed,
      asked: stats.asked,
      errors: stats.errors,
      noKey: stats.noKey,
      testCalls: stats.testCalls,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      costUsd: stats.costUsd,
      last: stats.last,
    };
  }

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const offStats = scope.webServer.register({
        kind: 'exact',
        path: '/jev-auto/stats',
        handler: async (req, res) => {
          if (!isLoopback(req)) {
            res.statusCode = 403;
            res.end();
            return;
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET, HEAD');
            res.end();
            return;
          }
          sendJson(res, 200, await statsSnapshot(), req.method === 'HEAD');
        },
      });
      const offTest = scope.webServer.register({
        kind: 'exact',
        path: '/jev-auto/test',
        handler: async (req, res) => {
          if (!isLoopback(req)) {
            res.statusCode = 403;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'POST');
            res.end();
            return;
          }
          req.resume();
          const keyInfo = await resolveKey();
          if (keyInfo === undefined) {
            sendJson(res, 200, { ok: false, error: 'no-key' });
            return;
          }
          const ping = await pingJev({
            endpoint: config.baseURL || 'https://api.typesafe.ai/v1/systemone',
            model: config.model || 'jev-latest',
            key: keyInfo.key,
            timeoutMs: Math.max(5000, score(config.timeoutMs, 4000)),
          });
          stats.testCalls += 1;
          if (ping.ok) {
            stats.inputTokens += ping.usage?.inputTokens ?? 0;
            stats.outputTokens += ping.usage?.outputTokens ?? 0;
            stats.costUsd += ping.usage?.costUsd ?? 0;
          }
          sendJson(res, 200, { ...ping, keySource: keyInfo.source });
        },
      });
      return () => {
        offStats();
        offTest();
      };
    }, 'jev-auto-approve routes');
  });

  ctx.logger.info(`jev-auto-approve: active (${runtimeMode})`);
}
