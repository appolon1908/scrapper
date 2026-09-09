import { z } from 'zod';
export const TenantIdSchema = z.string().regex(/^[a-zA-Z0-9:_-]{3,100}$/);
const page = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});
const url = z
  .string()
  .url()
  .refine((v) => ['http:', 'https:'].includes(new URL(v).protocol), 'http_or_https_required');
export const TenantCreateSchema = z
  .object({
    tenantId: TenantIdSchema.optional(),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
    displayName: z.string().min(2).max(200),
    plan: z.enum(['sandbox', 'standard', 'growth', 'enterprise']).default('standard'),
  })
  .strict();
export const TenantListSchema = page.extend({
  cursor: TenantIdSchema.optional(),
  status: z.enum(['draft', 'ready_read_only', 'active', 'suspended', 'decommissioned']).optional(),
});
export const VersionSchema = z.object({ version: z.number().int().min(1) }).strict();
export const LifecycleSchema = VersionSchema.extend({
  reason: z.string().min(3).max(1000),
}).strict();
export const SourceCreateSchema = z
  .object({
    name: z.string().min(2).max(200),
    sourceType: z.enum(['website', 'sitemap', 'directory', 'manual_list']),
    seedUrls: z.array(url).min(1).max(500),
    status: z.enum(['draft', 'active', 'paused']).default('draft'),
  })
  .strict();
export const SourceListSchema = page.extend({
  status: z.enum(['draft', 'active', 'paused', 'invalid', 'archived']).optional(),
});
export const SourceUpdateSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    seedUrls: z.array(url).min(1).max(500).optional(),
    status: z.enum(['draft', 'active', 'paused', 'invalid', 'archived']).optional(),
    version: z.number().int().min(1),
  })
  .strict();
export const ScheduleCreateSchema = z
  .object({
    sourceId: z.string().uuid().nullable().optional(),
    name: z.string().min(2).max(200),
    cronExpression: z.string().min(5).max(100),
    timezone: z.string().min(1).max(100).default('UTC'),
    profile: z.enum(['company', 'contacts', 'registry', 'full']).default('full'),
    browser: z.enum(['auto', 'http', 'playwright']).default('auto'),
  })
  .strict();
export const ScheduleListSchema = page.extend({
  status: z.enum(['active', 'paused', 'disabled', 'error']).optional(),
});
export const IntegrationCreateSchema = z
  .object({
    kind: z.enum(['middleware', 'n8n', 'odoo', 'webhook', 'registry']),
    displayName: z.string().min(2).max(200),
    endpointHost: z.string().max(255).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const IntegrationListSchema = page.extend({
  kind: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
});
export const ReviewListSchema = page.extend({ status: z.string().max(50).optional() });
export const ReviewDecisionSchema = VersionSchema.extend({
  note: z.string().max(2000).default(''),
}).strict();
export const DeliveryListSchema = page.extend({ status: z.string().max(50).optional() });
export const AuditListSchema = DeliveryListSchema.extend({
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine(
      (value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
      'audit_cursor_out_of_range',
    )
    .optional(),
});
export const ExportCreateSchema = z
  .object({
    resourceType: z.enum(['businesses', 'jobs', 'audit', 'reviews', 'deliveries']),
    format: z.enum(['csv', 'json']),
    query: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const BusinessListSchema = page.extend({
  minConfidence: z.coerce.number().min(0).max(1).default(0),
});
