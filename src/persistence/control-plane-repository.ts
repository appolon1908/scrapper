import crypto from 'node:crypto';
import { assertPublicHttpUrl } from '../security/url-policy.js';
import { pool, withTransaction } from './db.js';
import { insertAudit } from './audit-repository.js';

const page = (rows: any[], limit: number, key = 'id') => ({
  items: rows.slice(0, limit),
  nextCursor: rows.length > limit ? String(rows[limit - 1]?.[key] || '') : null,
});
const search = (value?: string) =>
  value?.trim() ? `%${value.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%` : null;
async function audit(
  client: any,
  ctx: any,
  action: string,
  type: string,
  id: string,
  metadata: Record<string, unknown> = {},
) {
  await insertAudit(client, {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    action,
    resourceType: type,
    resourceId: id,
    metadata,
  });
}

export class ControlPlaneRepository {
  async createTenant(input: any, ctx: any) {
    return withTransaction(async (c) => {
      const id = input.tenantId || `tenant_${input.slug.replaceAll('-', '_')}`;
      const r = await c.query(
        `insert into platform_tenants(tenant_id,slug,display_name,plan,created_by) values($1,$2,$3,$4,$5) returning *`,
        [id, input.slug, input.displayName, input.plan, ctx.actorId],
      );
      await audit(c, { ...ctx, tenantId: id }, 'tenant.created', 'tenant', id, {
        slug: input.slug,
      });
      return r.rows[0];
    });
  }
  async listTenants(q: any) {
    const r = await pool.query(
      `select * from platform_tenants where ($1::text is null or status=$1) and ($2::text is null or tenant_id>$2) and ($3::text is null or display_name ilike $3 escape '\\' or slug ilike $3 escape '\\') order by tenant_id limit $4`,
      [q.status || null, q.cursor || null, search(q.search), q.limit + 1],
    );
    return page(r.rows, q.limit, 'tenant_id');
  }
  async getTenant(id: string) {
    return (
      (await pool.query('select * from platform_tenants where tenant_id=$1', [id])).rows[0] || null
    );
  }
  async tenantSummary(id: string) {
    const tenant = await this.getTenant(id);
    if (!tenant) return null;
    const r = await pool.query(
      `select (select count(*) from tenant_sources where tenant_id=$1)::int sources,(select count(*) from tenant_schedules where tenant_id=$1)::int schedules,(select count(*) from tenant_integrations where tenant_id=$1)::int integrations,(select count(*) from business_reviews where tenant_id=$1 and status='pending')::int reviews,(select count(*) from crawl_jobs where tenant_id=$1)::int jobs,(select count(*) from business_entities where tenant_id=$1)::int businesses`,
      [id],
    );
    return { tenant, counts: r.rows[0] };
  }
  async transitionTenant(id: string, status: string, input: any, ctx: any) {
    return withTransaction(async (c) => {
      const r = await c.query(
        `update platform_tenants set status=$3,version=version+1,updated_at=now() where tenant_id=$1 and version=$2 returning *`,
        [id, input.version, status],
      );
      if (!r.rows[0]) return null;
      await audit(c, { ...ctx, tenantId: id }, 'tenant.status_changed', 'tenant', id, {
        to: status,
        reason: input.reason,
      });
      return r.rows[0];
    });
  }
  async createSource(t: string, input: any, ctx: any) {
    return withTransaction(async (c) => {
      const id = crypto.randomUUID();
      const r = await c.query(
        `insert into tenant_sources(id,tenant_id,name,source_type,seed_urls,status) values($1,$2,$3,$4,$5,$6) returning *`,
        [id, t, input.name, input.sourceType, JSON.stringify(input.seedUrls), input.status],
      );
      await audit(c, ctx, 'source.created', 'source', id);
      return r.rows[0];
    });
  }
  async listSources(t: string, q: any) {
    const r = await pool.query(
      `select * from tenant_sources where tenant_id=$1 and ($2::text is null or status=$2) and ($3::uuid is null or id>$3::uuid) and ($4::text is null or name ilike $4 escape '\\') order by id limit $5`,
      [t, q.status || null, q.cursor || null, search(q.search), q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async updateSource(t: string, id: string, input: any, ctx: any) {
    return withTransaction(async (c) => {
      const r = await c.query(
        `update tenant_sources set name=coalesce($4,name),seed_urls=coalesce($5,seed_urls),status=coalesce($6,status),validation_status=case when $5::jsonb is null then validation_status else 'not_checked' end,version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$3 returning *`,
        [
          t,
          id,
          input.version,
          input.name || null,
          input.seedUrls === undefined ? null : JSON.stringify(input.seedUrls),
          input.status || null,
        ],
      );
      if (!r.rows[0]) return null;
      await audit(c, ctx, 'source.updated', 'source', id);
      return r.rows[0];
    });
  }
  async validateSource(t: string, id: string, ctx: any) {
    const s = (
      await pool.query('select * from tenant_sources where tenant_id=$1 and id=$2', [t, id])
    ).rows[0];
    if (!s) return null;
    const checks: Array<{ url: string; valid: boolean; error?: string }> = [];
    for (const raw of s.seed_urls) {
      try {
        await assertPublicHttpUrl(raw);
        checks.push({ url: raw, valid: true });
      } catch (e) {
        checks.push({ url: raw, valid: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const valid = checks.every((x) => x.valid);
    return withTransaction(async (c) => {
      const r = await c.query(
        `update tenant_sources set validation_status=$3,validation_details=$4,last_validated_at=now(),version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$5 returning *`,
        [t, id, valid ? 'valid' : 'invalid', { checks }, s.version],
      );
      if (!r.rows[0]) throw new Error('source_version_conflict');
      await audit(c, ctx, 'source.validated', 'source', id, { valid });
      return r.rows[0];
    });
  }
  async createSchedule(t: string, input: any, ctx: any) {
    return withTransaction(async (c) => {
      const id = crypto.randomUUID();
      const r = await c.query(
        `insert into tenant_schedules(id,tenant_id,source_id,name,cron_expression,timezone,profile,browser) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          id,
          t,
          input.sourceId || null,
          input.name,
          input.cronExpression,
          input.timezone,
          input.profile,
          input.browser,
        ],
      );
      await audit(c, ctx, 'schedule.created', 'schedule', id, { executionEnabled: false });
      return r.rows[0];
    });
  }
  async listSchedules(t: string, q: any) {
    const r = await pool.query(
      `select * from tenant_schedules where tenant_id=$1 and ($2::text is null or status=$2) and ($3::uuid is null or id>$3::uuid) and ($4::text is null or name ilike $4 escape '\\') order by id limit $5`,
      [t, q.status || null, q.cursor || null, search(q.search), q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async setSchedule(
    t: string,
    id: string,
    status: string,
    version: number,
    enabled: boolean,
    ctx: any,
  ) {
    return withTransaction(async (c) => {
      const r = await c.query(
        `update tenant_schedules set status=$4,execution_enabled=$5,version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$3 returning *`,
        [t, id, version, status, enabled],
      );
      if (!r.rows[0]) return null;
      await audit(c, ctx, `schedule.${status}`, 'schedule', id, { executionEnabled: enabled });
      return r.rows[0];
    });
  }
  async createIntegration(t: string, input: any, ctx: any) {
    return withTransaction(async (c) => {
      const id = crypto.randomUUID();
      const r = await c.query(
        `insert into tenant_integrations(id,tenant_id,kind,display_name,endpoint_host,metadata,external_writes_enabled) values($1,$2,$3,$4,$5,$6,false) returning *`,
        [id, t, input.kind, input.displayName, input.endpointHost || null, input.metadata],
      );
      await audit(c, ctx, 'integration.created', 'integration', id, {
        externalWritesEnabled: false,
      });
      return r.rows[0];
    });
  }
  async listIntegrations(t: string, q: any) {
    const r = await pool.query(
      `select * from tenant_integrations where tenant_id=$1 and ($2::text is null or kind=$2) and ($3::text is null or status=$3) and ($4::uuid is null or id>$4::uuid) order by id limit $5`,
      [t, q.kind || null, q.status || null, q.cursor || null, q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async setIntegration(t: string, id: string, status: string, version: number, ctx: any) {
    return withTransaction(async (c) => {
      const r = await c.query(
        `update tenant_integrations set status=$4,external_writes_enabled=false,version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$3 returning *`,
        [t, id, version, status],
      );
      if (!r.rows[0]) return null;
      await audit(c, ctx, `integration.${status}`, 'integration', id);
      return r.rows[0];
    });
  }
  async listBusinesses(t: string, q: any) {
    const r = await pool.query(
      `select id,domain,display_name,confidence,record,first_seen_at,last_seen_at from business_entities where tenant_id=$1 and confidence>=$2 and ($3::uuid is null or id>$3::uuid) and ($4::text is null or display_name ilike $4 escape '\\' or domain ilike $4 escape '\\') order by id limit $5`,
      [t, q.minConfidence, q.cursor || null, search(q.search), q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async businessEvidence(t: string, id: string) {
    const b = (
      await pool.query(
        `select id,domain,display_name,confidence,record,first_seen_at,last_seen_at from business_entities where tenant_id=$1 and id=$2`,
        [t, id],
      )
    ).rows[0];
    if (!b) return null;
    const identifiers = (
      await pool.query(
        `select identifier_type,masked_value,verification_status,provider,evidence,first_seen_at,last_seen_at from business_identifiers where tenant_id=$1 and entity_id=$2`,
        [t, id],
      )
    ).rows;
    return { business: b, evidence: b.record?.evidence || {}, identifiers };
  }
  async listReviews(t: string, q: any) {
    const r = await pool.query(
      `select * from business_reviews where tenant_id=$1 and ($2::text is null or status=$2) and ($3::uuid is null or id>$3::uuid) and ($4::text is null or company_name ilike $4 escape '\\' or domain ilike $4 escape '\\') order by id limit $5`,
      [t, q.status || null, q.cursor || null, search(q.search), q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async decideReview(t: string, id: string, status: string, input: any, ctx: any) {
    return withTransaction(async (c) => {
      const r = await c.query(
        `update business_reviews set status=$4,decision_note=$5,decided_by=$6,decided_at=now(),version=version+1,updated_at=now() where tenant_id=$1 and id=$2 and version=$3 returning *`,
        [t, id, input.version, status, input.note, ctx.actorId],
      );
      if (!r.rows[0]) return null;
      await audit(c, ctx, `review.${status}`, 'review', id);
      return r.rows[0];
    });
  }
  async listOutbox(t: string, q: any) {
    const r = await pool.query(
      `select id,aggregate_type,aggregate_id,event_type,destination_path,status,attempts,available_at,delivered_at,last_error,created_at,updated_at from outbox_events where tenant_id=$1 and ($2::text is null or status=$2) and ($3::uuid is null or id>$3::uuid) order by id limit $4`,
      [t, q.status || null, q.cursor || null, q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async listInbox(t: string, q: any) {
    const r = await pool.query(
      `select id,message_id,message_type,source_id,status,attempts,available_at,last_error,created_at,updated_at from control_inbox_messages where tenant_id=$1 and ($2::text is null or status=$2) and ($3::uuid is null or id>$3::uuid) order by id limit $4`,
      [t, q.status || null, q.cursor || null, q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async listDead(t: string, q: any) {
    const r = await pool.query(
      `select * from control_dead_letters where tenant_id=$1 and ($2::text is null or status=$2) and ($3::uuid is null or id>$3::uuid) order by id limit $4`,
      [t, q.status || null, q.cursor || null, q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async replayOutbox(t: string, id: string, ctx: any) {
    return withTransaction(async (c) => {
      const r = await c.query(
        `update outbox_events set status='pending',available_at=now(),locked_at=null,locked_by=null,lock_token=null,last_error=null,updated_at=now() where tenant_id=$1 and id=$2 and status='dead_letter' returning id,status,event_type,attempts,available_at`,
        [t, id],
      );
      if (!r.rows[0]) return null;
      await audit(c, ctx, 'outbox.replayed', 'outbox', id);
      return r.rows[0];
    });
  }
  async createExport(t: string, input: any, ctx: any) {
    return withTransaction(async (c) => {
      const id = crypto.randomUUID();
      const r = await c.query(
        `insert into export_jobs(id,tenant_id,resource_type,format,query) values($1,$2,$3,$4,$5) returning *`,
        [id, t, input.resourceType, input.format, input.query],
      );
      await audit(c, ctx, 'export.created', 'export', id);
      return r.rows[0];
    });
  }
  async listExports(t: string, q: any) {
    const r = await pool.query(
      `select * from export_jobs where tenant_id=$1 and ($2::text is null or status=$2) and ($3::uuid is null or id>$3::uuid) order by id limit $4`,
      [t, q.status || null, q.cursor || null, q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async listAudit(t: string, q: any) {
    const r = await pool.query(
      `select id::text,actor_id,action,resource_type,resource_id,correlation_id,metadata,created_at from audit_events where tenant_id=$1 and ($2::bigint is null or id<$2::bigint) and ($3::text is null or action ilike $3 escape '\\' or resource_id ilike $3 escape '\\') order by id desc limit $4`,
      [t, q.cursor || null, search(q.search), q.limit + 1],
    );
    return page(r.rows, q.limit);
  }
  async summary(t: string) {
    const tenant = await this.getTenant(t);
    const c = (
      await pool.query(
        `select (select count(*) from tenant_sources where tenant_id=$1)::int sources,(select count(*) from tenant_schedules where tenant_id=$1)::int schedules,(select count(*) from tenant_integrations where tenant_id=$1)::int integrations,(select count(*) from business_reviews where tenant_id=$1 and status='pending')::int reviews,(select count(*) from control_dead_letters where tenant_id=$1 and status='open')::int dead_letters`,
        [t],
      )
    ).rows[0];
    return { tenant, counts: c };
  }
}
