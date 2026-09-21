/** Checkpoint data for the two-phase billing meter protocol. */
export interface BillingCheckpoint {
  lastReportedTotal: number;
  pendingReportedTotal: number | null;
  consecutiveFailures: number;
}

/**
 * Durable two-phase checkpoint: writeIntent before Stripe, confirm after.
 * Also tracks consecutive failures for the circuit breaker. Keyed by the
 * Stripe meter event name as well, because each meter reports its own running
 * total in its own unit. @see specs/instant-evals/instant-eval-billing.feature
 */
export abstract class BillingCheckpointRepository {
  abstract findCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
  }): Promise<BillingCheckpoint | null>;

  abstract writeIntent(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
  }): Promise<void>;

  abstract confirm(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
    lastReportedTotal: number;
  }): Promise<void>;

  abstract clearPendingAndIncrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
    consecutiveFailures: number;
  }): Promise<void>;

  abstract incrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
    consecutiveFailures: number;
  }): Promise<void>;
}
