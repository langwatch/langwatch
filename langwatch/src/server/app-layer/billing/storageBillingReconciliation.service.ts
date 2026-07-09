import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:billing:storageReconciliation");

const DEFAULT_TOLERANCE_RATIO = 0.01;

export interface StorageReconciliationDeps {
  /** Orgs with reported storage hours in the period (paid; already metered). */
  listReconcilableOrgs: (billingMonth: string) => Promise<string[]>;
  /** Σ of `StorageUsageHourly.megabytes` with `reportedAt` set, for the period. */
  sumReportedMegabytes: (params: {
    organizationId: string;
    billingMonth: string;
  }) => Promise<number>;
  /** Stripe's summed meter total (MiB-hours) for the period, or null if unavailable. */
  fetchStripeMeterTotal: (params: {
    organizationId: string;
    billingMonth: string;
  }) => Promise<number | null>;
  toleranceRatio?: number;
}

export interface ReconciliationResult {
  checked: number;
  drifted: number;
  unavailable: number;
}

/**
 * ADR-027 finance safety net (deferred, off the critical path): periodically
 * diffs what we recorded as reported (`Σ StorageUsageHourly.megabytes` with
 * `reportedAt` set) against Stripe's own meter total per org/period, and logs a
 * capped-severity warning on drift beyond tolerance. Catches anything the
 * measure-time tripwire and the idempotency layers missed — e.g. a report the
 * cursor marked done but Stripe never accepted. Observational; never mutates.
 */
export class StorageBillingReconciliationService {
  constructor(private readonly deps: StorageReconciliationDeps) {}

  async reconcile({
    billingMonth,
  }: {
    billingMonth: string;
  }): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      checked: 0,
      drifted: 0,
      unavailable: 0,
    };
    const tolerance = this.deps.toleranceRatio ?? DEFAULT_TOLERANCE_RATIO;

    const orgs = await this.deps.listReconcilableOrgs(billingMonth);
    for (const organizationId of orgs) {
      const reported = await this.deps.sumReportedMegabytes({
        organizationId,
        billingMonth,
      });
      const stripeTotal = await this.deps.fetchStripeMeterTotal({
        organizationId,
        billingMonth,
      });

      if (stripeTotal == null) {
        result.unavailable++;
        continue;
      }

      result.checked++;
      const diff = Math.abs(reported - stripeTotal);
      const scale = Math.max(reported, stripeTotal, 1);
      if (diff / scale > tolerance) {
        result.drifted++;
        logger.error(
          {
            organizationId,
            billingMonth,
            reportedMegabytes: reported,
            stripeMegabytes: stripeTotal,
            ratio: diff / scale,
          },
          "DRIFT: recorded storage total diverges from Stripe's meter total — " +
            "finance reconciliation required.",
        );
      }
    }

    logger.info({ billingMonth, ...result }, "storage reconciliation complete");
    return result;
  }
}
