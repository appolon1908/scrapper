import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { installApiErrorHandling } from '../dist/api/error-handler.js';
import { registerControlPlaneRoutes } from '../dist/api/routes/control-plane.js';
import { pool } from '../dist/persistence/db.js';
import { TenantCreateSchema } from '../dist/domain/control-plane.js';

const uuid = '90b8ea6f-3b1f-4fb8-bac9-9f44818fb156';
const resources = [
  'sources',
  'schedules',
  'integrations',
  'businesses',
  'reviews',
  'outbox',
  'inbox',
  'dead-letters',
  'exports',
];

async function setup(t) {
  const app = Fastify();
  t.after(() => app.close());
  installApiErrorHandling(app);
  app.addHook('onRequest', async (request) => {
    request.principal = {
      tenantId: 'tenant-test',
      clientId: 'client-test',
      scopes: ['*'],
      enabled: true,
      tokenSha256: '',
    };
  });
  const query = t.mock.method(pool, 'query', async () => ({ rows: [] }));
  await registerControlPlaneRoutes(app);
  return { app, query };
}

for (const resource of resources) {
  test(`${resource} rejects invalid cursors before querying persistence`, async (t) => {
    const { app, query } = await setup(t);
    const response = await app.inject(`/api/v2/${resource}?cursor=not-a-uuid`);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'invalid_query');
    assert.equal(query.mock.callCount(), 0);
    assert.equal((await app.inject(`/api/v2/${resource}?cursor=${uuid}`)).statusCode, 200);
    assert.ok(query.mock.calls[0].arguments[1].includes(uuid));
  });
}

test('audit cursors reject nondecimal and overflowing IDs without rounding valid bigint IDs', async (t) => {
  const { app, query } = await setup(t);
  for (const cursor of ['bad', uuid, '1.5', '1e3', '-1', '0', '9223372036854775808']) {
    const response = await app.inject(`/api/v2/audit-events?cursor=${cursor}`);
    assert.equal(response.statusCode, 400, cursor);
  }
  assert.equal(query.mock.callCount(), 0);
  const cursor = '9223372036854775807';
  assert.equal((await app.inject(`/api/v2/audit-events?cursor=${cursor}`)).statusCode, 200);
  assert.equal(query.mock.calls[0].arguments[1][1], cursor);
});

test('tenant creation and tenant pagination use the same identifier rules as tenant lookup', async (t) => {
  const { app, query } = await setup(t);
  for (const tenantId of ['has spaces', 'tenant/path', 'ab']) {
    assert.equal(
      TenantCreateSchema.safeParse({ tenantId, slug: 'test-tenant', displayName: 'Test tenant' })
        .success,
      false,
    );
    assert.equal(
      (await app.inject(`/platform/v2/tenants?cursor=${encodeURIComponent(tenantId)}`)).statusCode,
      400,
    );
  }
  assert.equal(query.mock.callCount(), 0);
  const tenantId = 'tenant:valid_1';
  assert.equal(
    TenantCreateSchema.safeParse({ tenantId, slug: 'test-tenant', displayName: 'Test tenant' })
      .success,
    true,
  );
  assert.equal((await app.inject(`/platform/v2/tenants?cursor=${tenantId}`)).statusCode, 200);
  assert.equal(query.mock.calls[0].arguments[1][1], tenantId);
});
