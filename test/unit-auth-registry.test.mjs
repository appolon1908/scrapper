import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { installApiErrorHandling } from '../dist/api/error-handler.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapper-auth-'));
const file = path.join(directory, 'principals.json');
process.env.SERVICE_PRINCIPALS_FILE = file;
const { authenticateRequest } = await import('../dist/security/auth.js');
const token = 'test-only-bearer-token-01234567890123456789';
const principal = {
  clientId: 'test-client',
  tenantId: 'test-tenant',
  scopes: ['jobs:read'],
  enabled: true,
  tokenSha256: crypto.createHash('sha256').update(token).digest('hex'),
};
let revision = 0;
function registry(value) {
  fs.writeFileSync(file, JSON.stringify({ principals: [value] }));
  const time = new Date(Date.now() + ++revision * 1000);
  fs.utimesSync(file, time, time);
}

test('principal registry fails closed for invalid field types and honors disabled principals', async (t) => {
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = Fastify();
  t.after(() => app.close());
  installApiErrorHandling(app);
  app.addHook('onRequest', authenticateRequest);
  app.get('/test', async (request) => ({ tenantId: request.principal.tenantId }));
  const request = () => app.inject({ url: '/test', headers: { authorization: `Bearer ${token}` } });
  registry(principal);
  assert.equal((await request()).statusCode, 200);
  for (const update of [
    { enabled: 'false' },
    { enabled: 1 },
    { tenantId: 123 },
    { clientId: {} },
  ]) {
    registry({ ...principal, ...update });
    assert.equal((await request()).statusCode, 500);
  }
  registry({ ...principal, enabled: false });
  assert.equal((await request()).statusCode, 401);
  registry(principal);
  assert.equal((await request()).statusCode, 200);
});
