import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { pool } from '../dist/persistence/db.js';
import { ControlPlaneRepository } from '../dist/persistence/control-plane-repository.js';

test('source edits retain validation only while seed URLs remain unchanged', async (t) => {
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://scrapper:scrapper@127.0.0.1:5432/scrapper',
  });
  await client.connect();
  t.after(() => client.end());
  await client.query(`create temporary table tenant_sources (
    id uuid, tenant_id text, name text, status text, seed_urls jsonb,
    validation_status text, validation_details jsonb not null,
    last_validated_at timestamptz, version integer, updated_at timestamptz
  )`);
  await client.query(`create temporary table audit_events (
    tenant_id text, actor_id text, action text, resource_type text,
    resource_id text, correlation_id text, metadata jsonb
  )`);
  t.mock.method(pool, 'connect', async () => ({
    query: (sql, values) => client.query(sql, values),
    release() {},
  }));
  const id = '00000000-0000-4000-8000-000000000001';
  await client.query(
    `insert into tenant_sources values ($1, 'tenant-a', 'Original', 'active', $2,
    'valid', $3, '2026-09-08T00:00:00Z', 1, now())`,
    [id, JSON.stringify(['https://example.test/old']), { checks: [{ valid: true }] }],
  );
  const ctx = { tenantId: 'tenant-a', actorId: 'tester', correlationId: 'test' };
  const repo = new ControlPlaneRepository();
  const renamed = await repo.updateSource('tenant-a', id, { version: 1, name: 'Renamed' }, ctx);
  assert.equal(renamed.validation_status, 'valid');
  assert.deepEqual(renamed.validation_details, { checks: [{ valid: true }] });
  assert.equal(renamed.last_validated_at.toISOString(), '2026-09-08T00:00:00.000Z');
  const changed = await repo.updateSource(
    'tenant-a',
    id,
    { version: 2, seedUrls: ['https://example.test/new'] },
    ctx,
  );
  assert.equal(changed.validation_status, 'not_checked');
  assert.deepEqual(changed.validation_details, {});
  assert.equal(changed.last_validated_at, null);
  assert.equal(changed.version, 3);
});
