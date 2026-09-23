import type { SsoDomainClaim } from "./connection.ts";
import { isPublicEmailDomain } from "./join-matching.ts";

/**
 * The two rails a domain claim runs between now that a published record, not
 * a person, decides it (ADR-117 §5): a domain nobody may own alone is refused,
 * and so is a burst of claims. Pure; the guards apply them.
 */

/** Registry suffixes, not companies. Multi-label only: a bare label is refused by arithmetic. */
const SSO_PUBLIC_SUFFIXES: readonly string[] = [
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "co.za",
  "com.au",
  "com.br",
  "com.cn",
  "com.mx",
  "com.sg",
  "net.au",
  "net.uk",
  "or.jp",
  "org.au",
  "org.uk",
];

const PUBLIC_SUFFIX_SET = new Set(SSO_PUBLIC_SUFFIXES);

/**
 * Whether an organization could own a domain alone: not a consumer mail
 * provider, not a registry suffix, and a public hostname — the proof FETCHES
 * `https://<domain>/.well-known/…`, so what passes is where our servers call.
 */
export function isClaimableSsoDomain(domain: string): boolean {
  const folded = domain.trim().toLowerCase();
  if (folded.length === 0) return false;
  if (!isPublicDnsHostname(folded)) return false;
  if (PUBLIC_SUFFIX_SET.has(folded)) return false;
  return !isPublicEmailDomain(folded);
}

/**
 * Letters, digits and inner hyphens per label, at least two labels, and a
 * last label that is not all digits — which refuses every IPv4 literal and a
 * userinfo trick like `evil.example@10.0.0.5` without parsing addresses.
 */
function isPublicDnsHostname(folded: string): boolean {
  if (folded.length > 253) return false;
  const labels = folded.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return false;
  }
  const last = labels[labels.length - 1] ?? "";
  return !/^\d+$/.test(last);
}

/**
 * Distinct domains one connection may claim per window, counted over the
 * claims the ledger records — no counter of our own to fall open. Generous
 * for a subsidiary or two, mean for walking a list.
 */
export const SSO_DOMAIN_CLAIM_WINDOW_MS = 60 * 60 * 1000;
export const SSO_DOMAIN_CLAIMS_PER_WINDOW = 5;

/** The claims made inside the window ending now. */
function recentDomainClaims({
  claims,
  nowMs,
  windowMs = SSO_DOMAIN_CLAIM_WINDOW_MS,
}: {
  claims: readonly SsoDomainClaim[];
  nowMs: number;
  windowMs?: number;
}): SsoDomainClaim[] {
  const since = nowMs - windowMs;
  return claims.filter((claim) => claim.claimedAtMs > since);
}

/** Seconds until the window has room, rounded up so the wait told is never still refused. */
export function domainClaimRetryAfterSeconds({
  claims,
  nowMs,
  windowMs = SSO_DOMAIN_CLAIM_WINDOW_MS,
  perWindow = SSO_DOMAIN_CLAIMS_PER_WINDOW,
}: {
  claims: readonly SsoDomainClaim[];
  nowMs: number;
  windowMs?: number;
  perWindow?: number;
}): number {
  const recent = recentDomainClaims({ claims, nowMs, windowMs }).toSorted(
    (left, right) => left.claimedAtMs - right.claimedAtMs,
  );
  if (recent.length < perWindow) return 0;
  const oldest = recent[recent.length - perWindow];
  if (!oldest) return 0;
  return Math.max(1, Math.ceil((oldest.claimedAtMs + windowMs - nowMs) / 1000));
}
