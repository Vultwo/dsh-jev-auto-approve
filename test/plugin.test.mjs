import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

function makeCtx() {
  const listeners = new Map();
  const commands = [];
  const commandService = {
    register(definition) {
      commands.push(definition);
      return () => {};
    },
  };
  const ctx = {
    effect(fn) {
      const generator = fn();
      generator.next();
    },
    on(event, handler) {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
    inject(names, callback) {
      if (names.includes('webServer')) return;
      callback({
        commands: {
          register(definition) {
            commands.push(definition);
            return () => {};
          },
        },
        effect(fn) {
          fn().next();
        },
      });
    },
    get(name) {
      return name === 'commands' ? commandService : undefined;
    },
    logger: {
      info() {},
      warn() {},
    },
  };
  return { ctx, listeners, commands };
}

function fakeRequest(reason = 'escalate sandbox to danger-full-access: plugin_manager {"action":"list_bundles"}') {
  return {
    toolName: 'plugin_manager',
    callId: 'call_1',
    reason,
    signal: undefined,
    agent: {
      session: {
        id: 'session-1',
        snapshotEvents: () => [
          {
            type: 'user/message',
            data: { message: { content: [{ type: 'text', text: 'Please install the plugin.' }] } },
          },
          {
            type: 'tool/call',
            data: { callId: 'call_1', name: 'plugin_manager', arguments: '{"action":"list_bundles"}' },
          },
        ],
      },
    },
  };
}

async function withServer(answers, fn) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    const payload = { model: 'jev-test', answers: answers(parsed) };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const passingAnswers = {
  safe: { type: 'noul', noul: 0.96 },
  irreversible: { type: 'noul', noul: 0.03 },
  authorized: { type: 'noul', noul: 0.91 },
};

test('approval listener auto-approves a passing review and registers /jev-auto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-auto-approve-'));
  try {
    await withServer(
      () => passingAnswers,
      async (port) => {
        const { ctx, listeners, commands } = makeCtx();
        apply(ctx, {
          enabled: true,
          mode: 'enforce',
          allowReadOnlyPluginManager: false,
          baseURL: `http://127.0.0.1:${port}`,
          apiKey: 'test-key',
          logFile: join(dir, 'decisions.jsonl'),
        });
        assert.equal(commands.length, 1);
        assert.equal(commands[0].name, 'jev-auto');
        const handler = listeners.get('approval/request');
        assert.equal(typeof handler, 'function');
        let nextCalled = false;
        const outcome = await handler(fakeRequest(), async () => {
          nextCalled = true;
          return 'unavailable';
        });
        assert.equal(outcome, 'allowed-once');
        assert.equal(nextCalled, false);
        const log = await readFile(join(dir, 'decisions.jsonl'), 'utf8');
        assert.match(log, /"outcome":"allowed"/);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('shadow mode logs but delegates to the human', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-auto-approve-'));
  try {
    await withServer(
      () => passingAnswers,
      async (port) => {
        const { ctx, listeners } = makeCtx();
        apply(ctx, {
          enabled: true,
          mode: 'shadow',
          allowReadOnlyPluginManager: false,
          baseURL: `http://127.0.0.1:${port}`,
          apiKey: 'test-key',
          logFile: join(dir, 'decisions.jsonl'),
        });
        let nextCalled = false;
        const outcome = await listeners.get('approval/request')(fakeRequest(), async () => {
          nextCalled = true;
          return 'allowed-once';
        });
        assert.equal(outcome, 'allowed-once');
        assert.equal(nextCalled, true);
        const log = await readFile(join(dir, 'decisions.jsonl'), 'utf8');
        assert.match(log, /"outcome":"would-allow"/);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failing review delegates to the human', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-auto-approve-'));
  try {
    await withServer(
      () => ({
        safe: { type: 'noul', noul: 0.2 },
        irreversible: { type: 'noul', noul: 0.8 },
        authorized: { type: 'noul', noul: 0.1 },
      }),
      async (port) => {
        const { ctx, listeners } = makeCtx();
        apply(ctx, {
          enabled: true,
          mode: 'enforce',
          allowReadOnlyPluginManager: false,
          baseURL: `http://127.0.0.1:${port}`,
          apiKey: 'test-key',
          logFile: join(dir, 'decisions.jsonl'),
        });
        let nextCalled = false;
        const outcome = await listeners.get('approval/request')(fakeRequest(), async () => {
          nextCalled = true;
          return 'unavailable';
        });
        assert.equal(outcome, 'unavailable');
        assert.equal(nextCalled, true);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing key delegates to the human', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-auto-approve-'));
  try {
    const { ctx, listeners } = makeCtx();
    apply(ctx, {
      enabled: true,
      mode: 'enforce',
      baseURL: 'http://127.0.0.1:1',
      apiKey: '',
      apiKeyEnv: 'JEV_AUTO_APPROVE_TEST_MISSING',
      apiKeyFile: join(dir, 'missing-key'),
      logFile: join(dir, 'decisions.jsonl'),
    });
    let nextCalled = false;
    const outcome = await listeners.get('approval/request')(fakeRequest(), async () => {
      nextCalled = true;
      return 'unavailable';
    });
    assert.equal(outcome, 'unavailable');
    assert.equal(nextCalled, true);
    const log = await readFile(join(dir, 'decisions.jsonl'), 'utf8');
    assert.match(log, /"outcome":"no-key"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('read-only plugin_manager actions auto-approve without a Jev call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-auto-approve-'));
  try {
    const { ctx, listeners } = makeCtx();
    apply(ctx, {
      enabled: true,
      mode: 'enforce',
      baseURL: 'http://127.0.0.1:1',
      apiKey: 'test-key',
      logFile: join(dir, 'decisions.jsonl'),
    });
    let nextCalled = false;
    const outcome = await listeners.get('approval/request')(fakeRequest(), async () => {
      nextCalled = true;
      return 'unavailable';
    });
    assert.equal(outcome, 'allowed-once');
    assert.equal(nextCalled, false);
    const log = await readFile(join(dir, 'decisions.jsonl'), 'utf8');
    assert.match(log, /"outcome":"allowed-readonly"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
