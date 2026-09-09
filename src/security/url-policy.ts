import dns from 'node:dns/promises';
import net from 'node:net';
import type { DomainPolicy } from '../persistence/types.js';

const TRACKING_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
]);

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported_url_protocol');
  if (url.username || url.password) throw new Error('url_credentials_forbidden');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function isProhibitedAddress(address: string): boolean {
  const normalized = address.toLowerCase();

  if (net.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number);
    const [a = 0, b = 0, c = 0] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (!net.isIPv6(normalized) || normalized.includes('%')) return true;
  // Canonicalize equivalent IPv6 spellings before applying address restrictions.
  const canonical = new URL(`http://[${normalized}]/`).hostname.slice(1, -1);
  if (canonical.startsWith('::ffff:')) {
    const words = canonical
      .slice(7)
      .split(':')
      .map((part) => Number.parseInt(part, 16));
    const [high = 0, low = 0] = words;
    return isProhibitedAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return (
    canonical === '::' ||
    canonical === '::1' ||
    canonical.startsWith('fc') ||
    canonical.startsWith('fd') ||
    canonical.startsWith('fe8') ||
    canonical.startsWith('fe9') ||
    canonical.startsWith('fea') ||
    canonical.startsWith('feb') ||
    canonical.startsWith('2001:db8:') ||
    canonical.startsWith('ff')
  );
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(normalizeUrl(raw));
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    throw new Error('private_destination_rejected');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (![80, 443].includes(port)) throw new Error('destination_port_rejected');

  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const resolved = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((item) => isProhibitedAddress(item.address))) {
    throw new Error('private_destination_rejected');
  }
  return url;
}

export function isAllowedServiceUrl(raw: string, allowedHosts: string[]): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const hostname = url.hostname.toLowerCase();
    return allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export function sameBusinessHost(seed: string, candidate: string): boolean {
  const seedHost = new URL(seed).hostname.toLowerCase().replace(/^www\./, '');
  const candidateHost = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
  return seedHost === candidateHost;
}

export function shouldVisitUrl(
  url: string,
  includePatterns: string[],
  excludePatterns: string[],
  domainPolicy?: Pick<DomainPolicy, 'blocked' | 'tos_review_status'> | null,
): boolean {
  if (domainPolicy?.blocked || domainPolicy?.tos_review_status === 'prohibited') return false;
  const value = url.toLowerCase();
  if (excludePatterns.some((pattern) => value.includes(pattern.toLowerCase()))) return false;
  if (includePatterns.length > 0) {
    return includePatterns.some((pattern) => value.includes(pattern.toLowerCase()));
  }
  return !/\.(?:7z|avi|bmp|css|csv|docx?|eot|exe|gif|gz|ico|jpe?g|json|m4a|mov|mp3|mp4|mpeg|pdf|png|pptx?|rar|rss|svg|tar|tgz|tiff?|ttf|wav|webm|webp|woff2?|xlsx?|xml|zip)(?:$|[?#])/i.test(
    value,
  );
}
