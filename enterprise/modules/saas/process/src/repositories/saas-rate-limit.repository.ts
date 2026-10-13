// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** What one rate-limit decision says. */
export type SaasRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the usage-report door, each key in the caller's own window. */
export interface SaasRateLimitRepository {
  /** Counts one request against `key`. */
  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<SaasRateLimitDecision>;
}
