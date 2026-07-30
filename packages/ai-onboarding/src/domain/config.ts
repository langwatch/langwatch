/**
 * Every window and ceiling the onboarding surface enforces, in one object.
 *
 * Nothing here is a constant inside a handler: a self-hosted install has to be
 * able to tighten the limits, or turn anonymous provisioning off entirely,
 * without patching code.
 */

/** One bucket: at most `max` requests per rolling `windowSeconds`. */
export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

export interface RateLimitConfig {
  /** Per client-reported device fingerprint. Tightest axis — one machine
   *  legitimately needs one account, so the budget is a day's worth. */
  fingerprint: RateLimitRule[];
  /** Per source address. Looser than fingerprint: an office NAT is a lot of
   *  genuine developers behind one address. */
  ip: RateLimitRule[];
  /** Per /24 (v4) or /64 (v6). Catches the cheapest evasion there is —
   *  rotating the last octet, or a fresh v6 address per connection. */
  ipSubnet: RateLimitRule[];
  /** The whole endpoint. A circuit breaker, not a per-caller budget. */
  global: RateLimitRule[];
  /** Claim attempts per source address. */
  claimIp: RateLimitRule[];
  /** Claim attempts that presented a token we could not resolve. Guessing a
   *  256-bit token is hopeless on paper; this makes trying anyway cost. */
  claimFailure: RateLimitRule[];
  /** Minimum gap between two `/claim/exchange` polls for one handoff. */
  pollIntervalSeconds: number;
}

export interface OnboardingConfig {
  /** Master switch. Off means `/provision` refuses outright. */
  provisioningEnabled: boolean;
  /** Days of ingestion before an unclaimed account goes read-only. */
  ingestionDays: number;
  /** Days from provisioning until an unclaimed account is deleted. */
  retentionDays: number;
  /** Lifetime of a single browser round-trip. Not a grace period — the
   *  30-day window belongs to the claim token, not to this code. */
  handoffTtlSeconds: number;
  /** Base URL of this control plane, used to build the claim URL. */
  appBaseUrl: string;
  /** Where agents export OTLP traffic. */
  otlpEndpoint: string;
  rateLimits: RateLimitConfig;
}

/**
 * Defaults matching the shipped free tier. A deployment overrides individual
 * fields; it never has to restate the whole object.
 */
export const defaultRateLimitConfig: RateLimitConfig = {
  fingerprint: [
    { windowSeconds: 60 * 60, max: 2 },
    { windowSeconds: 60 * 60 * 24, max: 3 },
  ],
  ip: [
    { windowSeconds: 60 * 60, max: 10 },
    { windowSeconds: 60 * 60 * 24, max: 30 },
  ],
  ipSubnet: [
    { windowSeconds: 60 * 60, max: 30 },
    { windowSeconds: 60 * 60 * 24, max: 60 },
  ],
  global: [{ windowSeconds: 60 * 60, max: 5_000 }],
  claimIp: [{ windowSeconds: 60 * 60, max: 60 }],
  claimFailure: [{ windowSeconds: 60 * 60, max: 10 }],
  pollIntervalSeconds: 5,
};

export const DEFAULT_INGESTION_DAYS = 7;
export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_HANDOFF_TTL_SECONDS = 15 * 60;

export function resolveConfig(
  overrides: Partial<OnboardingConfig> & Pick<OnboardingConfig, "appBaseUrl">,
): OnboardingConfig {
  return {
    provisioningEnabled: overrides.provisioningEnabled ?? true,
    ingestionDays: overrides.ingestionDays ?? DEFAULT_INGESTION_DAYS,
    retentionDays: overrides.retentionDays ?? DEFAULT_RETENTION_DAYS,
    handoffTtlSeconds:
      overrides.handoffTtlSeconds ?? DEFAULT_HANDOFF_TTL_SECONDS,
    appBaseUrl: overrides.appBaseUrl,
    otlpEndpoint:
      overrides.otlpEndpoint ?? `${trimSlash(overrides.appBaseUrl)}/api/otel`,
    rateLimits: {
      ...defaultRateLimitConfig,
      ...(overrides.rateLimits ?? {}),
    },
  };
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
