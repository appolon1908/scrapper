import crypto from 'node:crypto';
import type { CrawlJobRequest } from '../domain/schemas.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requestHash(payload: CrawlJobRequest): string {
  return crypto.createHash('sha256').update(stable(payload)).digest('hex');
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor) return null;
    const [createdAt, id, ...extra] = decoded.toString('utf8').split('|');
    if (
      extra.length ||
      !createdAt ||
      !id ||
      new Date(createdAt).toISOString() !== createdAt ||
      !UUID_PATTERN.test(id)
    ) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}
