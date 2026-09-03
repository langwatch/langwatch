/** Checkpoint data for the two-phase billing meter protocol. */
export interface BillingCheckpoint {
  lastReportedTotal: number;
  pendingReportedTotal: number | null;
  consecutiveFailures: number;
}

/**
 * The durable checkpoint the monthly roll-up reports against.
 *
 * Encapsulates the two-phase protocol the reportUsageForMonth command runs:
 * 1. writeIntent — sets pendingReportedTotal before calling Stripe
 * 2. confirm — promotes pending to lastReportedTotal, clears pending, resets failures
 *
 * Also carries failure tracking (consecutiveFailures) for the circuit breaker.
 */
export abstract class BillingCheckpointPort {
  abstract tryGetCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<BillingCheckpoint | null>;

  abstract writeIntent(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
  }): Promise<void>;

  abstract confirm(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
  }): Promise<void>;

  abstract clearPendingAndIncrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    consecutiveFailures: number;
  }): Promise<void>;

  abstract incrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
    consecutiveFailures: number;
  }): Promise<void>;
}
