import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import * as S from '../../domain/control-plane.js';
import { ControlPlaneRepository } from '../../persistence/control-plane-repository.js';
import { requireScope } from '../../security/auth.js';
import { ApiError } from '../error-handler.js';
import { requiredHeader, uuidParam } from '../support/headers.js';
const repo = new ControlPlaneRepository();
const parse = <T>(s: z.ZodType<T>, v: unknown, c: string): T => {
  const p = s.safeParse(v);
  if (!p.success) throw new ApiError(400, c, p.error.issues);
  return p.data;
};
const ctx = (r: any, t = r.principal.tenantId) => ({
  tenantId: t,
  actorId: r.principal.clientId,
  correlationId: requiredHeader(r, 'x-correlation-id', 'valid_correlation_id_required'),
});
const tenant = (r: any) => {
  return parse(S.TenantIdSchema, r.params.tenantId, 'invalid_tenant_id');
};
export async function registerControlPlaneRoutes(app: FastifyInstance) {
  app.post('/platform/v2/tenants', async (r, p) => {
    if (!(await requireScope(r, p, 'platform:admin'))) return;
    return p
      .code(201)
      .send(
        await repo.createTenant(
          parse(S.TenantCreateSchema, r.body, 'invalid_tenant'),
          ctx(r, 'platform'),
        ),
      );
  });
  app.get('/platform/v2/tenants', async (r, p) => {
    if (!(await requireScope(r, p, 'platform:admin'))) return;
    const x = await repo.listTenants(parse(S.TenantListSchema, r.query, 'invalid_query'));
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.get('/platform/v2/tenants/:tenantId', async (r, p) => {
    if (!(await requireScope(r, p, 'platform:admin'))) return;
    return (await repo.getTenant(tenant(r))) || p.code(404).send({ error: 'not_found' });
  });
  app.get('/platform/v2/tenants/:tenantId/summary', async (r, p) => {
    if (!(await requireScope(r, p, 'platform:admin'))) return;
    return (await repo.tenantSummary(tenant(r))) || p.code(404).send({ error: 'not_found' });
  });
  for (const [a, s] of [
    ['activate', 'active'],
    ['suspend', 'suspended'],
    ['decommission', 'decommissioned'],
  ] as const)
    app.post(`/platform/v2/tenants/:tenantId/${a}`, async (r, p) => {
      if (!(await requireScope(r, p, 'platform:admin'))) return;
      return (
        (await repo.transitionTenant(
          tenant(r),
          s,
          parse(S.LifecycleSchema, r.body, 'invalid_lifecycle'),
          ctx(r, tenant(r)),
        )) || p.code(409).send({ error: 'version_conflict_or_not_found' })
      );
    });
  app.post('/api/v2/sources', async (r, p) => {
    if (!(await requireScope(r, p, 'sources:write'))) return;
    return p
      .code(201)
      .send(
        await repo.createSource(
          r.principal.tenantId,
          parse(S.SourceCreateSchema, r.body, 'invalid_source'),
          ctx(r),
        ),
      );
  });
  app.get('/api/v2/sources', async (r, p) => {
    if (!(await requireScope(r, p, 'sources:read'))) return;
    const x = await repo.listSources(
      r.principal.tenantId,
      parse(S.SourceListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.patch('/api/v2/sources/:id', async (r, p) => {
    if (!(await requireScope(r, p, 'sources:write'))) return;
    return (
      (await repo.updateSource(
        r.principal.tenantId,
        uuidParam(r, 'id'),
        parse(S.SourceUpdateSchema, r.body, 'invalid_source_update'),
        ctx(r),
      )) || p.code(409).send({ error: 'version_conflict_or_not_found' })
    );
  });
  app.post('/api/v2/sources/:id/validate', async (r, p) => {
    if (!(await requireScope(r, p, 'sources:write'))) return;
    return (
      (await repo.validateSource(r.principal.tenantId, uuidParam(r, 'id'), ctx(r))) ||
      p.code(404).send({ error: 'not_found' })
    );
  });
  app.post('/api/v2/schedules', async (r, p) => {
    if (!(await requireScope(r, p, 'schedules:write'))) return;
    return p
      .code(201)
      .send(
        await repo.createSchedule(
          r.principal.tenantId,
          parse(S.ScheduleCreateSchema, r.body, 'invalid_schedule'),
          ctx(r),
        ),
      );
  });
  app.get('/api/v2/schedules', async (r, p) => {
    if (!(await requireScope(r, p, 'schedules:read'))) return;
    const x = await repo.listSchedules(
      r.principal.tenantId,
      parse(S.ScheduleListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  for (const [a, s, e] of [
    ['pause', 'paused', false],
    ['resume', 'active', true],
  ] as const)
    app.post(`/api/v2/schedules/:id/${a}`, async (r, p) => {
      if (!(await requireScope(r, p, 'schedules:write'))) return;
      if (e && !config.scheduleExecutionEnabled)
        return p.code(409).send({ error: 'schedule_execution_disabled' });
      const b = parse(S.VersionSchema, r.body, 'invalid_schedule_command');
      return (
        (await repo.setSchedule(
          r.principal.tenantId,
          uuidParam(r, 'id'),
          s,
          b.version,
          e,
          ctx(r),
        )) || p.code(409).send({ error: 'version_conflict_or_not_found' })
      );
    });
  app.post('/api/v2/integrations', async (r, p) => {
    if (!(await requireScope(r, p, 'integrations:write'))) return;
    return p
      .code(201)
      .send(
        await repo.createIntegration(
          r.principal.tenantId,
          parse(S.IntegrationCreateSchema, r.body, 'invalid_integration'),
          ctx(r),
        ),
      );
  });
  app.get('/api/v2/integrations', async (r, p) => {
    if (!(await requireScope(r, p, 'integrations:read'))) return;
    const x = await repo.listIntegrations(
      r.principal.tenantId,
      parse(S.IntegrationListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  for (const [a, s] of [
    ['pause', 'paused'],
    ['resume', 'configured'],
  ] as const)
    app.post(`/api/v2/integrations/:id/${a}`, async (r, p) => {
      if (!(await requireScope(r, p, 'integrations:write'))) return;
      const b = parse(S.VersionSchema, r.body, 'invalid_integration_command');
      return (
        (await repo.setIntegration(
          r.principal.tenantId,
          uuidParam(r, 'id'),
          s,
          b.version,
          ctx(r),
        )) || p.code(409).send({ error: 'version_conflict_or_not_found' })
      );
    });
  app.get('/api/v2/businesses', async (r, p) => {
    if (!(await requireScope(r, p, 'businesses:read'))) return;
    const x = await repo.listBusinesses(
      r.principal.tenantId,
      parse(S.BusinessListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.get('/api/v2/businesses/:id/evidence', async (r, p) => {
    if (!(await requireScope(r, p, 'businesses:read'))) return;
    return (
      (await repo.businessEvidence(r.principal.tenantId, uuidParam(r, 'id'))) ||
      p.code(404).send({ error: 'not_found' })
    );
  });
  app.get('/api/v2/reviews', async (r, p) => {
    if (!(await requireScope(r, p, 'reviews:read'))) return;
    const x = await repo.listReviews(
      r.principal.tenantId,
      parse(S.ReviewListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  for (const [a, s] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
    ['merge', 'merged'],
    ['split', 'split'],
    ['reopen', 'reopened'],
  ] as const)
    app.post(`/api/v2/reviews/:id/${a}`, async (r, p) => {
      if (!(await requireScope(r, p, 'reviews:write'))) return;
      if (!config.reviewMutationsEnabled)
        return p.code(409).send({ error: 'review_mutations_disabled' });
      return (
        (await repo.decideReview(
          r.principal.tenantId,
          uuidParam(r, 'id'),
          s,
          parse(S.ReviewDecisionSchema, r.body, 'invalid_review'),
          ctx(r),
        )) || p.code(409).send({ error: 'version_conflict_or_not_found' })
      );
    });
  app.get('/api/v2/outbox', async (r, p) => {
    if (!(await requireScope(r, p, 'deliveries:read'))) return;
    const x = await repo.listOutbox(
      r.principal.tenantId,
      parse(S.DeliveryListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.get('/api/v2/inbox', async (r, p) => {
    if (!(await requireScope(r, p, 'deliveries:read'))) return;
    const x = await repo.listInbox(
      r.principal.tenantId,
      parse(S.DeliveryListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.get('/api/v2/dead-letters', async (r, p) => {
    if (!(await requireScope(r, p, 'deliveries:read'))) return;
    const x = await repo.listDead(
      r.principal.tenantId,
      parse(S.DeliveryListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.post('/api/v2/outbox/:id/replay', async (r, p) => {
    if (!(await requireScope(r, p, 'deliveries:replay'))) return;
    if (!config.outboxReplayEnabled) return p.code(409).send({ error: 'delivery_replay_disabled' });
    return (
      (await repo.replayOutbox(r.principal.tenantId, uuidParam(r, 'id'), ctx(r))) ||
      p.code(409).send({ error: 'not_replayable' })
    );
  });
  app.post('/api/v2/exports', async (r, p) => {
    if (!(await requireScope(r, p, 'exports:write'))) return;
    if (!config.exportProcessingEnabled)
      return p.code(409).send({ error: 'server_exports_disabled' });
    return p
      .code(202)
      .send(
        await repo.createExport(
          r.principal.tenantId,
          parse(S.ExportCreateSchema, r.body, 'invalid_export'),
          ctx(r),
        ),
      );
  });
  app.get('/api/v2/exports', async (r, p) => {
    if (!(await requireScope(r, p, 'exports:read'))) return;
    const x = await repo.listExports(
      r.principal.tenantId,
      parse(S.DeliveryListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.get('/api/v2/audit-events', async (r, p) => {
    if (!(await requireScope(r, p, 'audit:read'))) return;
    const x = await repo.listAudit(
      r.principal.tenantId,
      parse(S.AuditListSchema, r.query, 'invalid_query'),
    );
    return { items: x.items, next_cursor: x.nextCursor };
  });
  app.get('/api/v2/control-plane/summary', async (r, p) => {
    if (!(await requireScope(r, p, 'operations:read'))) return;
    return repo.summary(r.principal.tenantId);
  });
}
