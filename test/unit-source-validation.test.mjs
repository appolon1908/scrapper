import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import test from 'node:test';
import pgUtils from 'pg/lib/utils.js';
import { pool } from '../dist/persistence/db.js';
import { ControlPlaneRepository } from '../dist/persistence/control-plane-repository.js';

const context = { tenantId: 'tenant-test', actorId: 'client-test', correlationId: 'test-request' };
const source = {
  id: '90b8ea6f-3b1f-4fb8-bac9-9f44818fb156',
  version: 3,
  seed_urls: ['https://public.example.test'],
};
function database(t, { record = source, updateRows = [source] } = {}) {
  t.mock.method(pool, 'query', async () => ({ rows: [record] }));
  const calls = [];
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: sql.startsWith('update tenant_sources') ? updateRows : [source] };
    },
    release() {},
  }));
  return calls;
}

test('source URL arrays reach PostgreSQL as JSON on both create and update', async (t) => {
  const calls = database(t);
  const repo = new ControlPlaneRepository();
  const seedUrls = ['https://example.test/a', 'https://example.test/b'];
  await repo.createSource(
    'tenant-test',
    { name: 'Test', sourceType: 'website', seedUrls, status: 'draft' },
    context,
  );
  await repo.updateSource('tenant-test', source.id, { version: 3, seedUrls }, context);
  for (const call of calls.filter(
    ({ sql }) =>
      sql.startsWith('insert into tenant_sources') || sql.startsWith('update tenant_sources'),
  )) {
    assert.deepEqual(JSON.parse(pgUtils.prepareValue(call.values[4])), seedUrls);
  }
});

for (const [label, seedUrls, addresses] of [
  ['private IP', ['http://127.0.0.1'], [{ address: '127.0.0.1', family: 4 }]],
  [
    'mixed public/private DNS',
    source.seed_urls,
    [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
  ],
  [
    'nonstandard port',
    ['https://public.example.test:8080'],
    [{ address: '93.184.216.34', family: 4 }],
  ],
]) {
  test(`source validation rejects ${label}`, async (t) => {
    const calls = database(t, { record: { ...source, seed_urls: seedUrls } });
    t.mock.method(dns, 'lookup', async (_host, options) =>
      options?.all ? addresses : addresses[0],
    );
    await new ControlPlaneRepository().validateSource('tenant-test', source.id, context);
    const update = calls.find(({ sql }) => sql.startsWith('update tenant_sources'));
    assert.equal(update.values[2], 'invalid');
    assert.ok(update.values[3].checks.every((check) => check.valid === false));
  });
}

test('source validation accepts a public destination and binds the checked version', async (t) => {
  const calls = database(t);
  t.mock.method(dns, 'lookup', async (_host, options) =>
    options?.all
      ? [{ address: '93.184.216.34', family: 4 }]
      : { address: '93.184.216.34', family: 4 },
  );
  await new ControlPlaneRepository().validateSource('tenant-test', source.id, context);
  const update = calls.find(({ sql }) => sql.startsWith('update tenant_sources'));
  assert.equal(update.values[2], 'valid');
  assert.equal(update.values[4], source.version);
  assert.match(update.sql, /version=\$5/);
});

test('a concurrent edit rejects stale validation and rolls back without a success audit', async (t) => {
  const calls = database(t, { updateRows: [] });
  t.mock.method(dns, 'lookup', async (_host, options) =>
    options?.all
      ? [{ address: '93.184.216.34', family: 4 }]
      : { address: '93.184.216.34', family: 4 },
  );
  await assert.rejects(
    new ControlPlaneRepository().validateSource('tenant-test', source.id, context),
    /source_version_conflict/,
  );
  assert.ok(calls.some(({ sql }) => sql === 'rollback'));
  assert.ok(!calls.some(({ sql }) => sql.includes('insert into audit_events')));
});

test('stale source validation is exposed as an HTTP conflict', async (t) => {
  const { default: Fastify } = await import('fastify');
  const { installApiErrorHandling } = await import('../dist/api/error-handler.js');
  const app = Fastify();
  t.after(() => app.close());
  installApiErrorHandling(app);
  database(t, { updateRows: [] });
  t.mock.method(dns, 'lookup', async (_host, options) =>
    options?.all
      ? [{ address: '93.184.216.34', family: 4 }]
      : { address: '93.184.216.34', family: 4 },
  );
  app.post('/validate', () =>
    new ControlPlaneRepository().validateSource('tenant-test', source.id, context),
  );
  const response = await app.inject({ method: 'POST', url: '/validate' });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, 'source_version_conflict');
});
