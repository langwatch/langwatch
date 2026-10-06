// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** What one rate-limit decision says; a refusal carries when to retry. */
export type GovernanceRateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds?: number;
}>;

/** Fixed-window counters for the push receivers' per-caller throttle. */
export abstract class GovernanceRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<GovernanceRateLimitDecision>;
}
