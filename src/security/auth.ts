import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export type ServicePrincipal = {
  clientId: string;
  tenantId: string;
  tokenSha256: string;
  scopes: string[];
  enabled: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    principal: ServicePrincipal;
  }
}

class PrincipalRegistry {
  private principals: ServicePrincipal[] = [];
  private loadedAt = 0;
  private mtimeMs = -1;

  private load(): void {
    if (!config.servicePrincipalsFile) {
      this.principals = [];
      return;
    }

    const stat = fs.statSync(config.servicePrincipalsFile);
    if (stat.mtimeMs === this.mtimeMs && Date.now() - this.loadedAt < 30_000) return;

    const parsed = JSON.parse(fs.readFileSync(config.servicePrincipalsFile, 'utf8')) as {
      principals?: ServicePrincipal[];
    };
    const principals = Array.isArray(parsed.principals) ? parsed.principals : [];
    const digests = new Set<string>();

    for (const principal of principals) {
      if (
        !principal ||
        typeof principal.clientId !== 'string' ||
        !principal.clientId.trim() ||
        typeof principal.tenantId !== 'string' ||
        !principal.tenantId.trim() ||
        typeof principal.enabled !== 'boolean' ||
        !Array.isArray(principal.scopes) ||
        principal.scopes.some((scope) => typeof scope !== 'string' || !scope)
      ) {
        throw new Error('invalid_service_principal_registry');
      }
      if (
        typeof principal.tokenSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(principal.tokenSha256)
      ) {
        throw new Error(`invalid_principal_digest:${principal.clientId}`);
      }

      const digest = principal.tokenSha256.toLowerCase();
      if (digests.has(digest)) {
        throw new Error(`duplicate_principal_digest:${principal.clientId}`);
      }
      digests.add(digest);
    }

    this.principals = principals;
    this.mtimeMs = stat.mtimeMs;
    this.loadedAt = Date.now();
  }

  authenticate(authorization: string): ServicePrincipal | null {
    this.load();
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    const token = match?.[1]?.trim() || '';
    if (token.length < 32) return null;

    const digest = crypto.createHash('sha256').update(token).digest('hex');
    const matches = this.principals.filter((principal) => {
      if (!principal.enabled || principal.tokenSha256.length !== digest.length) return false;
      return crypto.timingSafeEqual(
        Buffer.from(principal.tokenSha256, 'hex'),
        Buffer.from(digest, 'hex'),
      );
    });
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }
}

const registry = new PrincipalRegistry();

export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const principal = registry.authenticate(String(request.headers.authorization || ''));
  if (!principal) {
    await reply.code(401).send({ error: 'unauthorized' });
    return false;
  }

  const claimedTenant = String(request.headers['x-tenant-id'] || '');
  if (claimedTenant && claimedTenant !== principal.tenantId) {
    await reply.code(403).send({ error: 'tenant_claim_mismatch' });
    return false;
  }

  request.principal = principal;
  return true;
}

export function hasScope(principal: ServicePrincipal, scope: string): boolean {
  return principal.scopes.includes(scope) || principal.scopes.includes('*');
}

export async function requireScope(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
): Promise<boolean> {
  if (!hasScope(request.principal, scope)) {
    await reply.code(403).send({ error: 'forbidden', required_scope: scope });
    return false;
  }
  return true;
}
