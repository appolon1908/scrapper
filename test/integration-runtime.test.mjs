import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://scrapper:scrapper@127.0.0.1:5432/scrapper';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.EIN_FINGERPRINT_PEPPER = 'integration-test-pepper';
process.env.JOB_LEASE_SECONDS = '120';
process.env.JOB_HEARTBEAT_SECONDS = '10';
process.env.OUTBOX_LEASE_SECONDS = '30';

const pgModule = await import('pg');
const { Client } = pgModule.default;
const { pool, rollbackLastMigration, runMigrations } = await import('../dist/persistence/db.js');
const { Repository } = await import('../dist/persistence/repository.js');
const { CrawlJobRequestSchema } = await import('../dist/domain/schemas.js');
const { closeQueues, crawlQueue, crawlQueueJobId, enqueueCrawlJob } =
  await import('../dist/queues.js');

const expectedMigrations = [
  '001_initial.sql',
  '002_tenant_integrity.sql',
  '003_runtime_leases.sql',
  '004_turnkey_control_plane.sql',
  '005_discovery.sql',
  '006_source_authorization.sql',
];

const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();

async function resetDatabase() {
  await admin.query('drop schema if exists public cascade');
  await admin.query('create schema public');
}

async function migrationNames() {
  const result = await pool.query('select filename from schema_migrations order by filename');
  return result.rows.map((row) => row.filename);
}

test('real PostgreSQL and Redis runtime contract', async (t) => {
  t.after(async () => {
    await crawlQueue.obliterate({ force: true }).catch(() => undefined);
    await closeQueues().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  await resetDatabase();

  await t.test(
    'migrations apply idempotently and latest migration rolls back/reapplies',
    async () => {
      await runMigrations();
      assert.deepEqual(await migrationNames(), expectedMigrations);

      await runMigrations();
      assert.equal((await migrationNames()).length, expectedMigrations.length);

      assert.equal(await rollbackLastMigration(), '006_source_authorization.sql');
      const removedPolicyTable = await pool.query(
        `select to_regclass('public.domain_policies') as relation`,
      );
      assert.equal(removedPolicyTable.rows[0]?.relation, null);
      const removedAuthorizationColumns = await pool.query(
        `select 1 from information_schema.columns
         where table_schema='public' and table_name='tenant_sources'
           and column_name in ('authorization_basis','authorization_reference')`,
      );
      assert.equal(removedAuthorizationColumns.rowCount, 0);

      await runMigrations();
      assert.deepEqual(await migrationNames(), expectedMigrations);
      assert.equal(
        (await pool.query(`select to_regclass('public.domain_policies') as relation`)).rows[0]
          ?.relation,
        'domain_policies',
      );
    },
  );

  const repository = new Repository();
  const payload = CrawlJobRequestSchema.parse({
    seedUrls: ['https://example.com/'],
    maxPages: 1,
    maxCompanies: 1,
    maxDepth: 0,
    browser: 'http',
  });

  await t.test('job idempotency and tenant constraints fail closed', async () => {
    const first = await repository.createJob({
      tenantId: 'tenant-a',
      requestedBy: 'integration-test',
      correlationId: crypto.randomUUID(),
      idempotencyKey: 'integration-idempotency-key',
      payload,
    });
    const duplicate = await repository.createJob({
      tenantId: 'tenant-a',
      requestedBy: 'integration-test',
      correlationId: crypto.randomUUID(),
      idempotencyKey: 'integration-idempotency-key',
      payload,
    });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.job.id, first.job.id);

    await assert.rejects(
      repository.createJob({
        tenantId: 'tenant-a',
        requestedBy: 'integration-test',
        correlationId: crypto.randomUUID(),
        idempotencyKey: 'integration-idempotency-key',
        payload: { ...payload, maxPages: 2 },
      }),
      /idempotency_conflict/,
    );

    const entityId = crypto.randomUUID();
    await pool.query(
      `insert into business_entities(
        id,tenant_id,entity_key,domain,display_name,record,confidence,first_seen_at,last_seen_at
      ) values($1,'tenant-b','entity-b','example.org','Example B','{}'::jsonb,0.5,now(),now())`,
      [entityId],
    );
    await assert.rejects(
      pool.query(
        `insert into job_business_records(job_id,entity_id,tenant_id,confidence)
         values($1,$2,'tenant-a',0.5)`,
        [first.job.id, entityId],
      ),
      /job_business_records_tenant_entity_fk/,
    );
  });

  await t.test('expired job leases are recoverable and stale workers are fenced', async () => {
    const created = await repository.createJob({
      tenantId: 'tenant-a',
      requestedBy: 'integration-test',
      correlationId: crypto.randomUUID(),
      idempotencyKey: `lease-${crypto.randomUUID()}`,
      payload,
    });
    const tokenA = crypto.randomUUID();
    const claimedA = await repository.claimJobRun(
      created.job.id,
      created.job.version,
      'worker-a',
      tokenA,
      120,
    );
    assert.ok(claimedA);
    assert.equal(claimedA.worker_id, 'worker-a');

    const competing = await repository.claimJobRun(
      created.job.id,
      created.job.version,
      'worker-b',
      crypto.randomUUID(),
      120,
    );
    assert.equal(competing, null);

    await pool.query(
      `update crawl_jobs set lease_expires_at=now()-interval '1 second' where id=$1`,
      [created.job.id],
    );
    const requeued = await repository.requeueExpiredJobRuns(10);
    const dispatch = requeued.find((item) => item.id === created.job.id);
    assert.ok(dispatch);

    assert.equal(await repository.renewJobLease(created.job.id, tokenA, {}, 120), null);
    await assert.rejects(repository.finalizeJob(created.job.id, tokenA, {}), /stale_worker_lease/);

    const tokenB = crypto.randomUUID();
    const claimedB = await repository.claimJobRun(
      created.job.id,
      dispatch.version,
      'worker-b',
      tokenB,
      120,
    );
    assert.ok(claimedB);
    await repository.finalizeJob(created.job.id, tokenB, { pagesProcessed: 1 });
    const finished = await repository.getJob('tenant-a', created.job.id);
    assert.equal(finished?.status, 'completed');
    assert.equal(finished?.run_token, null);
  });

  await t.test('outbox acknowledgements are fenced to the active claimant', async () => {
    const pending = await pool.query(
      `select id from outbox_events where status='pending' order by created_at limit 1`,
    );
    const eventId = pending.rows[0]?.id;
    assert.ok(eventId);

    const lockA = crypto.randomUUID();
    const lockB = crypto.randomUUID();
    const claimedA = await repository.claimOutbox('delivery-a', lockA, 10);
    assert.ok(claimedA.some((event) => event.id === eventId));
    await pool.query(`update outbox_events set locked_at=now()-interval '60 seconds' where id=$1`, [
      eventId,
    ]);
    assert.ok((await repository.releaseStaleOutboxLocks()) >= 1);

    const claimedB = await repository.claimOutbox('delivery-b', lockB, 10);
    assert.ok(claimedB.some((event) => event.id === eventId));
    assert.equal(await repository.markOutboxDelivered(eventId, 'delivery-a', lockA), false);
    assert.equal(await repository.markOutboxDelivered(eventId, 'delivery-b', lockB), true);
  });

  await t.test('Redis queue dispatch is deterministic for one database version', async () => {
    await crawlQueue.obliterate({ force: true });
    const jobId = crypto.randomUUID();
    const queueId = crawlQueueJobId(jobId, 7);
    assert.equal(await enqueueCrawlJob(jobId, 7), queueId);
    assert.equal(await enqueueCrawlJob(jobId, 7), queueId);
    const jobs = await crawlQueue.getJobs(['waiting', 'delayed', 'active']);
    assert.equal(jobs.filter((job) => job.id === queueId).length, 1);
  });

  await t.test('full disposable migration rollback and reapply succeeds', async () => {
    for (const filename of [...expectedMigrations].reverse()) {
      assert.equal(await rollbackLastMigration(), filename);
    }
    const absent = await pool.query(`select to_regclass('public.crawl_jobs') as relation`);
    assert.equal(absent.rows[0]?.relation, null);

    await runMigrations();
    assert.deepEqual(await migrationNames(), expectedMigrations);
  });
});
