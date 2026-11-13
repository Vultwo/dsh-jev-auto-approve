import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, decide, parseScores, pingJev } from '../lib/classify.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const passing = {
  safe: { type: 'noul', noul: 0.96 },
  irreversible: { type: 'noul', noul: 0.03 },
  authorized: { type: 'noul', noul: 0.91 },
};

test('decide allows when every gate passes', () => {
  const result = decide({ safe: 0.96, irreversible: 0.03, authorized: 0.91 }, {});
  assert.equal(result.action, 'allow');
});

test('decide asks when safe is below threshold', () => {
  const result = decide({ safe: 0.5, irreversible: 0.03, authorized: 0.91 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /safe/);
});

test('decide asks when irreversible is above threshold', () => {
  const result = decide({ safe: 0.96, irreversible: 0.4, authorized: 0.91 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /irreversible/);
});

test('decide asks when authorized is below threshold', () => {
  const result = decide({ safe: 0.96, irreversible: 0.03, authorized: 0.2 }, {});
  assert.equal(result.action, 'ask');
  assert.match(result.reason, /authorized/);
});

test('decide asks on missing scores', () => {
  assert.equal(decide({ safe: 0.96 }, {}).action, 'ask');
  assert.equal(decide(null, {}).action, 'ask');
});

test('parseScores validates noul answers', () => {
  assert.deepEqual(parseScores({ answers: passing }), {
    safe: 0.96,
    irreversible: 0.03,
    authorized: 0.91,
  });
  assert.throws(() => parseScores({ answers: { safe: { type: 'choice', choice: 'yes' } } }));
  assert.throws(() => parseScores({ answers: { safe: { type: 'noul', noul: 2 } } }));
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
  assert.equal(request.body.questions.safe.type, 'noul');
  assert.equal(request.body.questions.irreversible.type, 'noul');
  assert.equal(request.body.questions.authorized.type, 'noul');
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
        safe: { type: 'noul', noul: 0.4 },
        irreversible: { type: 'noul', noul: 0.03 },
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
