import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUESTIONS, QUESTION_NAMES, classify, decide, parseScores, pingJev } from '../lib/classify.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const passing = {
  destructive: { type: 'noul', noul: 0.03 },
  exfiltration: { type: 'noul', noul: 0.02 },
  security_mode: { type: 'noul', noul: 0.04 },
  authorized: { type: 'noul', noul: 0.91 },
};

const passingScores = { destructive: 0.03, exfiltration: 0.02, security_mode: 0.04, authorized: 0.91 };

test('the question set is four narrow judgements', () => {
  assert.deepEqual(QUESTION_NAMES, ['destructive', 'exfiltration', 'security_mode', 'authorized']);
  for (const name of QUESTION_NAMES) {
    assert.equal(DEFAULT_QUESTIONS[name].type, 'noul');
  }
});

test('decide allows when every gate passes', () => {
  const result = decide(passingScores, {});
  assert.equal(result.action, 'allow');
});

test('decide allows an authorized plugin toggle that the old safe gate blocked', () => {
  const result = decide({ destructive: 0.12, exfiltration: 0.02, security_mode: 0.19, authorized: 0.88 }, {});
  assert.equal(result.action, 'allow');
});

test('decide asks when destructive is above threshold', () => {
  const result = decide({ ...passingScores, destructive: 0.4 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /^destructive/);
});

test('decide asks when exfiltration is above threshold', () => {
  const result = decide({ ...passingScores, exfiltration: 0.5 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /^exfiltration/);
});

test('decide asks when the security posture would change', () => {
  const result = decide({ ...passingScores, security_mode: 0.7 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /^security_mode/);
});

test('decide asks when the user did not authorize the call', () => {
  const result = decide({ ...passingScores, authorized: 0.2 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /^authorized/);
});

test('decide honors configured thresholds', () => {
  assert.equal(decide({ ...passingScores, authorized: 0.88 }, { authorizedThreshold: 0.9 }).action, 'ask');
  assert.equal(decide({ ...passingScores, destructive: 0.4 }, { destructiveMax: 0.5 }).action, 'allow');
});

test('decide asks on missing scores', () => {
  assert.equal(decide({ destructive: 0.03 }, {}).action, 'ask');
  assert.equal(decide(null, {}).action, 'ask');
});

test('decide asks when a retired question name is supplied', () => {
  const result = decide({ safe: 0.96, irreversible: 0.03, authorized: 0.91 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /^missing score: destructive/);
});

test('parseScores validates noul answers', () => {
  assert.deepEqual(parseScores({ answers: passing }), passingScores);
  assert.throws(() => parseScores({ answers: { destructive: { type: 'choice', choice: 'yes' } } }));
  assert.throws(() => parseScores({ answers: { destructive: { type: 'noul', noul: 2 } } }));
});

test('classify sends the typed questions and returns allow', async () => {
  let request;
  const fetchFn = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return response({ model: 'jev-test', answers: passing });
  };
  const result = await classify({
    endpoint: 'https://example.test/v1',
    model: 'jev-test',
    key: 'secret-key',
    state: { tool: 'bash', reason: 'write a file' },
    config: {},
    fetchFn,
  });
  assert.equal(result.action, 'allow');
  assert.equal(result.model, 'jev-test');
  assert.equal(request.init.headers.authorization, 'Bearer secret-key');
  for (const name of QUESTION_NAMES) {
    assert.equal(request.body.questions[name].type, 'noul');
  }
  assert.equal(request.body.state.tool, 'bash');
});

test('classify carries measured usage for the stats page', async () => {
  const fetchFn = async () =>
    response({
      model: 'jev-test',
      answers: passing,
      usage: { input_tokens: 501, output_tokens: 7, cost: 0.00002 },
    });
  const result = await classify({
    endpoint: 'https://example.test/v1',
    model: 'jev-test',
    key: 'secret-key',
    state: {},
    config: {},
    fetchFn,
  });
  assert.deepEqual(result.usage, { inputTokens: 501, outputTokens: 7, costUsd: 0.00002 });
});

test('classify asks when the review gates fail', async () => {
  const fetchFn = async () =>
    response({
      answers: {
        destructive: { type: 'noul', noul: 0.4 },
        exfiltration: { type: 'noul', noul: 0.02 },
        security_mode: { type: 'noul', noul: 0.04 },
        authorized: { type: 'noul', noul: 0.91 },
      },
    });
  const result = await classify({
    endpoint: 'https://example.test/v1',
    model: 'jev-test',
    key: 'secret-key',
    state: {},
    config: {},
    fetchFn,
  });
  assert.equal(result.action, 'ask');
});

test('classify throws on HTTP failure so the caller can fail closed', async () => {
  const fetchFn = async () => response({ error: 'nope' }, 500);
  await assert.rejects(
    () =>
      classify({
        endpoint: 'https://example.test/v1',
        model: 'jev-test',
        key: 'secret-key',
        state: {},
        config: { timeoutMs: 50 },
        fetchFn,
      }),
    /HTTP 500/,
  );
});

test('pingJev reports a successful connection', async () => {
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.questions.ping.type, 'noul');
    return response({ model: 'jev-test', answers: { ping: { type: 'noul', noul: 0.99 } } });
  };
  const result = await pingJev({
    endpoint: 'https://example.test/v1',
    model: 'jev-test',
    key: 'secret-key',
    fetchFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'jev-test');
});

test('pingJev reports an HTTP failure', async () => {
  const fetchFn = async () => response({}, 401);
  const result = await pingJev({
    endpoint: 'https://example.test/v1',
    model: 'jev-test',
    key: 'secret-key',
    fetchFn,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 401/);
});
