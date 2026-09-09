import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { decodeCursor, encodeCursor } from '../dist/persistence/serialization.js';
import { JobRepository } from '../dist/persistence/job-repository.js';
import { pool } from '../dist/persistence/db.js';
import { installApiErrorHandling } from '../dist/api/error-handler.js';

const id = '00000000-0000-4000-8000-000000000001';
const createdAt = '2026-09-08T12:34:56.789Z';
const encode = (timestamp) => Buffer.from(`${timestamp}|${id}`).toString('base64url');

test('job cursors round-trip the server timestamp and identifier', () => {
  assert.deepEqual(decodeCursor(encodeCursor(new Date(createdAt), id)), { createdAt, id });
});

for (const timestamp of ['0', '2026-02-30T00:00:00.000Z', 'September 8, 2026', '2026-09-08']) {
  test(`job cursors reject noncanonical timestamp ${timestamp}`, () => {
    assert.equal(decodeCursor(encode(timestamp)), null);
  });
}

test('job cursors reject ignored characters in base64 input', () => {
  assert.equal(decodeCursor(`!${encode(createdAt)}`), null);
  assert.equal(decodeCursor(`${encode(createdAt)}\n`), null);
});

test('invalid job timestamps return HTTP 400 before database access', async (t) => {
  const query = t.mock.method(pool, 'query', async () => {
    throw new Error('unexpected_database_access');
  });
  const app = Fastify();
  t.after(() => app.close());
  installApiErrorHandling(app);
  app.get('/jobs', () => new JobRepository().list('tenant-a', { limit: 20, cursor: encode('0') }));
  const response = await app.inject('/jobs');
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'invalid_cursor');
  assert.equal(query.mock.callCount(), 0);
});
