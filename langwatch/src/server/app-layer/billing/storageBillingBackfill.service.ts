import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:billing:storageBackfill");

/** One paid subscription eligible for the STORAGE_GB item. */
export interface BackfillCandidate {
  organizationId: string;
  stripeSubscriptionId: string;
  /** The (plan × currency × interval) key used to resolve the storage price. */
  plan: string;
  currency: string;
  interval: "month" | "year";
}

export interface StorageBillingBackfillDeps {
  /** Active PAID subscriptions only — free / self-hosted are never returned. */
  listPaidSubscriptions: () => Promise<BackfillCandidate[]>;
  /** The STORAGE_GB metered price id for a (plan × currency × interval), or null. */
  resolveStoragePriceId: (params: {
    plan: string;
    currency: string;
    interval: "month" | "year";
  }) => string | null;
  /** Current Stripe subscription-item price ids for a subscription. */
  getSubscriptionItemPriceIds: (
    stripeSubscriptionId: string,
  ) => Promise<string[]>;
  /** Attach the metered item; must not change the cycle or subscription_id. */
  attachStorageItem: (params: {
    stripeSubscriptionId: string;
    priceId: string;
  }) => Promise<void>;
}

export interface BackfillResult {
  attached: number;
  alreadyAttached: number;
  noPrice: number;
  failed: number;
}

/**
 * ADR-027 Phase 7 rollout: attaches the `STORAGE_GB` SubscriptionItem to active
 * paid subscriptions so they begin accruing storage usage on the next cycle.
 *
 * Idempotent — an item already present is skipped, so it is safe to re-run and
 * to run alongside live traffic. Free / self-hosted orgs never appear (the query
 * returns paid subscriptions only). A subscription whose (plan × currency ×
 * interval) has no storage price is skipped and counted, never guessed.
 *
 * Runs only after the customer notice, on the announced date (see the runbook).
 * `dryRun` reports what it would do without mutating Stripe.
 */
export class StorageBillingBackfillService {
  constructor(private readonly deps: StorageBillingBackfillDeps) {}

  async run({ dryRun }: { dryRun: boolean }): Promise<BackfillResult> {
    const result: BackfillResult = {
      attached: 0,
      alreadyAttached: 0,
      noPrice: 0,
      failed: 0,
    };

    const candidates = await this.deps.listPaidSubscriptions();
    for (const c of candidates) {
      const priceId = this.deps.resolveStoragePriceId({
        plan: c.plan,
        currency: c.currency,
        interval: c.interval,
      });
      if (!priceId) {
        result.noPrice++;
        logger.warn(
          { organizationId: c.organizationId, plan: c.plan, currency: c.currency, interval: c.interval },
          "no STORAGE_GB price for this plan/currency/interval — skipping",
        );
        continue;
      }

      try {
        const existing = await this.deps.getSubscriptionItemPriceIds(
          c.stripeSubscriptionId,
        );
        if (existing.includes(priceId)) {
          result.alreadyAttached++;
          continue;
        }

        if (dryRun) {
          logger.info(
            { organizationId: c.organizationId, priceId, subscription: c.stripeSubscriptionId },
            "[dry-run] would attach STORAGE_GB item",
          );
          result.attached++;
          continue;
        }

        await this.deps.attachStorageItem({
          stripeSubscriptionId: c.stripeSubscriptionId,
          priceId,
        });
        result.attached++;
      } catch (error) {
        result.failed++;
        logger.error(
          { organizationId: c.organizationId, subscription: c.stripeSubscriptionId, error },
          "failed to attach STORAGE_GB item — continuing; re-run is idempotent",
        );
      }
    }

    logger.info({ dryRun, ...result }, "STORAGE_GB backfill complete");
    return result;
  }
}
