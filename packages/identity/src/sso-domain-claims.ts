import type { SsoDomainClaim } from "./connection";
import { isPublicEmailDomain } from "./join-matching";

/**
 * The two rails a domain claim runs between, now that a published record
 * decides a claim rather than a person (ADR-117 §5).
 *
 * Both exist because the review step used to be a human reading every claim,
 * and taking a human out of the loop takes away the place where "gmail.com,
 * really?" and "this is the four hundredth domain today" were noticed. Pure
 * and total, like the rest of this package: the guards apply them, and the
 * surfaces may apply them again as a courtesy.
 */

/**
 * Suffixes that are registries rather than companies.
 *
 * A hand-maintained list rather than the public suffix list itself, for the
 * reason the consumer-mail deny-list next door is one: the full list is a
 * dependency that updates on somebody else's schedule, and what it would buy
 * here is coverage of registry suffixes nobody has ever tried to claim. What
 * it must catch is the shape a mistake or an attack actually takes — a bare
 * `com`, a `co.uk` — and the label-count rule below catches every
 * single-label suffix without naming any of them.
 *
 * Entries are the MULTI-label ones only: a single-label suffix is refused by
 * arithmetic, so listing `com` here would be a second, weaker copy of a rule
 * that already holds for every top-level domain on earth.
 */
export const SSO_PUBLIC_SUFFIXES: readonly string[] = [
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
 * Whether a domain is one an organization could actually own alone.
 *
 * Takes the domain in the fold `normalizeDomain` produces, so this and the
 * routing that reads a verified domain can never disagree about what
 * "GMAIL.com" is.
 *
 * Three refusals, and each is a domain no proof could make legitimate: a
 * consumer mail provider, whose customers are everybody; a registry suffix,
 * which is not a company's to hold; and a single label, which is a top-level
 * domain however it was typed. A record published at `_langwatch-verification.com`
 * would be genuine evidence that somebody controls the registry, and that is
 * precisely the claim we must not honour.
 */
export function isClaimableSsoDomain(domain: string): boolean {
  const folded = domain.trim().toLowerCase();
  if (folded.length === 0) return false;
  if (!isPublicDnsHostname(folded)) return false;
  if (PUBLIC_SUFFIX_SET.has(folded)) return false;
  return !isPublicEmailDomain(folded);
}

/**
 * Whether a string is a hostname that could exist in public DNS.
 *
 * A claimed domain is not only a name we compare addresses against — we FETCH
 * it. The proof's second channel builds `https://<domain>/.well-known/...`
 * and asks for it from our own network, so anything a customer can get past
 * this function is somewhere our servers will make a request to.
 *
 * "At least two dot-separated labels" is not a hostname check. It admitted
 * `169.254.169.254` (four labels, no registry suffix, not a mail provider),
 * `metadata.google.internal`, and — because nothing checked the characters —
 * `evil.example@10.0.0.5`, which a URL parses as userinfo followed by a host
 * on the internal network. Each label is now letters, digits and hyphens
 * only, not starting or ending with a hyphen, and a name whose last label is
 * numeric is refused outright: no public registry sells one, and every IPv4
 * literal has one.
 */
function isPublicDnsHostname(folded: string): boolean {
  if (folded.length > 253) return false;
  const labels = folded.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return false;
  }
  // The last label of a real hostname is a registry suffix, which is never
  // all digits. This is what refuses every IPv4 literal without pretending to
  // be an address parser.
  const last = labels[labels.length - 1] ?? "";
  return !/^\d+$/.test(last);
}

/**
 * How many domains one connection may claim in a window, and how long the
 * window is.
 *
 * Counted over the claims the ledger already records rather than through a
 * counter of our own, which is what makes the number honest: it is derived
 * from the facts an operator would read in a dispute, it survives a restart,
 * and there is no second store to fall open when it is unavailable. What it
 * bounds is DISTINCT domains — a repeated claim on the same domain states no
 * new fact, so it can neither be the attack nor be charged for.
 *
 * Five an hour is generous for the thing customers actually do, which is
 * claim one domain and occasionally a second for a subsidiary, and mean for
 * the thing an attacker does, which is walk a list.
 */
export const SSO_DOMAIN_CLAIM_WINDOW_MS = 60 * 60 * 1000;
export const SSO_DOMAIN_CLAIMS_PER_WINDOW = 5;

/** The claims made inside the window ending now. */
export function recentDomainClaims({
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

/**
 * How long until the window has room again, in seconds, rounded up so the
 * number a customer is told is never one they would find still refused.
 * Zero when there is room now.
 */
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
  const recent = recentDomainClaims({ claims, nowMs, windowMs }).sort(
    (left, right) => left.claimedAtMs - right.claimedAtMs,
  );
  if (recent.length < perWindow) return 0;
  // The oldest claim still inside the window is the one whose leaving makes
  // room, so that is the instant to answer with.
  const oldest = recent[recent.length - perWindow];
  if (!oldest) return 0;
  return Math.max(1, Math.ceil((oldest.claimedAtMs + windowMs - nowMs) / 1000));
}
