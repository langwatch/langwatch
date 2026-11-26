// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Stops the tiered plans an active Growth seat subscription replaces, whatever order Stripe's
 * messages arrive in. Spec: enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { createLogger } from "@langwatch/observability";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  BillingWebhookSubscriptionRepository,
  SubscriptionWithOrg,
} from "../repositories/billing-webhook-subscription.repository.ts";
import type { BillingSubscriptionStatus } from "../rules/billing-stripe-shapes.rules.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";

const logger = createLogger("langwatch:billing:tieredPlanRetirement");

/** Stripe statuses after which a subscription bills nothing more. */
const ENDED_AT_STRIPE: ReadonlySet<BillingSubscriptionStatus> = new Set([
  "canceled",
  "incomplete_expired",
]);

/** Retiring a superseded plan failed; the caller fails the delivery after its other steps. */
export class SupersededPlanRetirementError extends Error {
  constructor({ failures }: { failures: unknown[] }) {
    super("Failed to retire the tiered plans a Growth seat subscription supersedes", {
      cause: failures.length === 1 ? failures[0] : new AggregateError(failures),
    });
    this.name = "SupersededPlanRetirementError";
  }
}

type TieredPlanRetirementDeps = {
  subscriptions: Pick<BillingWebhookSubscriptionRepository, "findSupersededBySeatEvent" | "cancel">;
  stripeSubscriptions: Pick<StripeSubscriptionsChannel, "getSubscription" | "cancelSubscription">;
  /** Records the pricing-model fact organization reacts to; absent where nothing composes one. */
  announcer?: Pick<BillingLifecycleAnnouncerService, "pricingModelChanged">;
};

export class TieredPlanRetirementService {
  static create(deps: TieredPlanRetirementDeps): TieredPlanRetirementService {
    return new TieredPlanRetirementService(deps);
  }

  private constructor(private readonly deps: TieredPlanRetirementDeps) {}

  /**
   * Safe to run again: Stripe goes first and its own status says what already ended, so a
   * failure leaves the row for Stripe's redelivery to find. Throws after trying every plan.
   */
  async retire({
    seat,
    firstActivation,
  }: {
    seat: SubscriptionWithOrg;
    firstActivation: boolean;
  }): Promise<void> {
    const superseded = await this.deps.subscriptions.findSupersededBySeatEvent({
      organizationId: seat.organizationId,
      excludeSubscriptionId: seat.id,
    });
    if (superseded.length === 0 && !firstActivation) return;

    // Organization sets the pricing model from the fact; a refused fact fails before any row moves.
    try {
      await this.deps.announcer?.pricingModelChanged({
        organizationId: seat.organizationId,
        pricingModel: "SEAT_EVENT",
      });
    } catch (err) {
      throw new SupersededPlanRetirementError({ failures: [err] });
    }

    const failures: unknown[] = [];
    for (const old of superseded) {
      try {
        await this.cancelAtStripe(old.stripeSubscriptionId);
        await this.deps.subscriptions.cancel({ id: old.id });
      } catch (err) {
        logger.error(
          { stripeSubscriptionId: old.stripeSubscriptionId, err },
          "[stripeWebhook] Failed to cancel a superseded tiered subscription; the delivery will be retried",
        );
        failures.push(err);
      }
    }
    if (failures.length > 0) throw new SupersededPlanRetirementError({ failures });
  }

  /** Cancels with proration unless Stripe already ended it, including by a parallel delivery. */
  private async cancelAtStripe(subscriptionId: string): Promise<void> {
    const current = await this.deps.stripeSubscriptions.getSubscription({ subscriptionId });
    if (ENDED_AT_STRIPE.has(current.status)) return;

    try {
      await this.deps.stripeSubscriptions.cancelSubscription({ subscriptionId, prorate: true });
    } catch (err) {
      const after = await this.deps.stripeSubscriptions.getSubscription({ subscriptionId });
      if (!ENDED_AT_STRIPE.has(after.status)) throw err;
    }
  }
}
