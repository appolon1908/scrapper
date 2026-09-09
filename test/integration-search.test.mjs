import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { pool } from '../dist/persistence/db.js';
import { ControlPlaneRepository } from '../dist/persistence/control-plane-repository.js';

test('source search treats SQL wildcards and backslashes literally within the tenant', async (t) => {
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://scrapper:scrapper@127.0.0.1:5432/scrapper',
  });
  await client.connect();
  t.after(() => client.end());
  await client.query(
    'create temporary table tenant_sources (id uuid, tenant_id text, name text, status text)',
  );
  t.mock.method(pool, 'query', (sql, values) => client.query(sql, values));
  const names = ['a\\%b', 'a\\_b', 'ends\\', '100%', 'under_score'];
  for (const [index, name] of names.entries()) {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await client.query(
      "insert into tenant_sources values ($1, 'tenant-a', $2, 'draft'), ($1, 'tenant-b', $2, 'draft')",
      [id, name],
    );
  }
  await client.query(
    "insert into tenant_sources values ('00000000-0000-4000-8000-000000000099', 'tenant-a', '100X underXscore a\\ZZb', 'draft')",
  );
  const repo = new ControlPlaneRepository();
  for (const name of names) {
    const result = await repo.listSources('tenant-a', { search: name, limit: 20 });
    assert.deepEqual(
      result.items.map((item) => item.name),
      [name],
      name,
    );
    assert.ok(result.items.every((item) => item.tenant_id === 'tenant-a'));
  }
});
