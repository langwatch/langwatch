/**
 * Reporter failure tracking per (org, billing month) — LEAN by decision:
 * per-hour reporting needs no accumulator columns, only enough state for
 * the circuit breaker's consecutive-failure count.
 */
export interface StorageBillingCheckpointRepository {
  /** Increments and returns the org-month's consecutive failure count. */
  recordFailure(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<{ consecutiveFailures: number }>;
  /** Resets the count after a successful report. */
  resetFailures(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<void>;
}
