import { z } from 'zod';
import { config } from '../config.js';

const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => ['http:', 'https:'].includes(new URL(value).protocol),
    'http_or_https_required',
  )
  .refine(
    (value) => !new URL(value).username && !new URL(value).password,
    'url_credentials_forbidden',
  );

export const CrawlJobRequestSchema = z.object({
  seedUrls: z.array(httpUrl).min(1).max(config.maxJobCompanies),
  profile: z.enum(['company', 'contacts', 'registry', 'full']).default('full'),
  mode: z.enum(['single', 'domain', 'list', 'discovery']).default('domain'),
  browser: z.enum(['auto', 'http', 'playwright']).default('auto'),
  maxPages: z.number().int().min(1).max(config.maxJobPages).default(250),
  maxCompanies: z
    .number()
    .int()
    .min(1)
    .max(config.maxJobCompanies)
    .default(Math.min(500, config.maxJobCompanies)),
  maxDepth: z.number().int().min(0).max(8).default(3),
  requestsPerSecond: z
    .number()
    .min(0.1)
    .max(config.perHostRequestsPerSecond)
    .default(config.perHostRequestsPerSecond),
  includePatterns: z.array(z.string().min(1).max(300)).max(50).default([]),
  excludePatterns: z.array(z.string().min(1).max(300)).max(50).default([]),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default(config.defaultCountryCode),
  callbackReference: z.string().max(200).optional(),
  tags: z.record(z.string().max(100), z.string().max(500)).default({}),
  verification: z
    .object({
      knownEin: z
        .string()
        .regex(/^\d{2}-?\d{7}$/)
        .optional(),
      provider: z.string().max(100).optional(),
      consentReference: z.string().max(200).optional(),
    })
    .optional(),
});

export const JobListQuerySchema = z.object({
  status: z
    .enum(['queued', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});

export const ResultListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().uuid().optional(),
  minConfidence: z.coerce.number().min(0).max(1).default(0),
});

export type CrawlJobRequest = z.infer<typeof CrawlJobRequestSchema>;
export type JobListQuery = z.infer<typeof JobListQuerySchema>;
export type ResultListQuery = z.infer<typeof ResultListQuerySchema>;

export type JobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';

export type Evidence = {
  sourceUrl: string;
  extractor: string;
  capturedAt: string;
  label?: string;
};

export type PublicOfficer = {
  name: string;
  title: string;
  email?: string;
  phone?: string;
  confidence: number;
  evidence: Evidence[];
};

export type BusinessRecord = {
  entityKey: string;
  legalName: string | null;
  displayName: string;
  website: string;
  domain: string;
  description: string | null;
  emails: string[];
  phones: string[];
  addresses: string[];
  socialProfiles: string[];
  categories: string[];
  officers: PublicOfficer[];
  einMasked: string | null;
  einFingerprint: string | null;
  einStatus: 'not_observed' | 'observed_public' | 'verified' | 'mismatch' | 'manual_review';
  confidence: number;
  evidence: Record<string, Evidence[]>;
  firstSeenAt: string;
  lastSeenAt: string;
};
