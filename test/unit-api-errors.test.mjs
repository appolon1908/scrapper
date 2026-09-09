import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { installApiErrorHandling } from '../dist/api/error-handler.js';

for (const [name, headers, payload, status, code] of [
  ['malformed JSON', { 'content-type': 'application/json' }, '{', 400, 'invalid_json'],
  ['empty JSON', { 'content-type': 'application/json' }, '', 400, 'invalid_json'],
  [
    'oversized body',
    { 'content-type': 'application/json' },
    JSON.stringify({ data: 'x'.repeat(100) }),
    413,
    'payload_too_large',
  ],
  [
    'unsupported media type',
    { 'content-type': 'application/xml' },
    '<data/>',
    415,
    'unsupported_media_type',
  ],
]) {
  test(`API returns the correct client error for ${name}`, async (t) => {
    const app = Fastify({ bodyLimit: 64 });
    t.after(() => app.close());
    installApiErrorHandling(app);
    let calls = 0;
    app.post('/test', async () => {
      calls++;
      return { ok: true };
    });
    const response = await app.inject({ method: 'POST', url: '/test', headers, payload });
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error, code);
    assert.ok(response.json().request_id);
    assert.equal(calls, 0);
  });
}

test('unexpected errors do not disclose raw exception messages in logs or responses', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installApiErrorHandling(app);
  const logs = [];
  t.mock.method(console, 'error', (entry) => logs.push(entry));
  app.get('/test', async () => {
    throw new Error('password=private-test-value');
  });
  const response = await app.inject('/test');
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error, 'internal_error');
  assert.doesNotMatch(response.body + logs.join(''), /private-test-value/);
});
