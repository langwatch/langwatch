// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Stops the tiered plans an active Growth seat subscription replaces, whatever order Stripe's
 * messages arrive in. Spec: enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { createLogger } from "@langwatch/observability";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { BillingWebhookOrganizationRepository } from "../repositories/billing-webhook-organization.repository.ts";
import type {
  BillingWebhookSubscriptionRepository,
  SubscriptionWithOrg,
} from "../repositories/billing-webhook-subscription.repository.ts";
import { ENDED_SUBSCRIPTION_STATUSES } from "../rules/billing-stripe-shapes.rules.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";

const logger = createLogger("langwatch:billing:tieredPlanRetirement");

/** Stripe's refusal for an object it does not hold; the subscriptions channel passes it through. */
function isResourceMissing(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && err.code === "resource_missing"
  );
}

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
  organizations: Pick<BillingWebhookOrganizationRepository, "isOnSeatEventPricing">;
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
   * Safe to run again: the organization's own pricing and Stripe's own status say what is left,
   * so a failure leaves it for Stripe's redelivery to find. Throws after trying every plan.
   */
  async retire({ seat }: { seat: SubscriptionWithOrg }): Promise<void> {
    const { superseded, onSeatPricing } = await this.remaining(seat).catch((err: unknown) => {
      throw new SupersededPlanRetirementError({ failures: [err] });
    });
    if (superseded.length === 0 && onSeatPricing) return;
    // A row we cancelled can still bill: the old upgrade marked rows before asking Stripe.

    // Organization sets the pricing model from the fact; a refused fact fails before any row moves.
    if (!onSeatPricing) {
      await this.deps.announcer
        ?.pricingModelChanged({ organizationId: seat.organizationId, pricingModel: "SEAT_EVENT" })
        .catch((err: unknown) => {
          throw new SupersededPlanRetirementError({ failures: [err] });
        });
    }

    const failures: unknown[] = [];
    for (const old of superseded) {
      try {
        await this.cancelAtStripe(old.stripeSubscriptionId);
        if (!old.cancelledInRecords) await this.deps.subscriptions.cancel({ id: old.id });
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

  private async remaining(seat: SubscriptionWithOrg) {
    const [superseded, onSeatPricing] = await Promise.all([
      this.deps.subscriptions.findSupersededBySeatEvent({
        organizationId: seat.organizationId,
        excludeSubscriptionId: seat.id,
      }),
      this.deps.organizations.isOnSeatEventPricing({ organizationId: seat.organizationId }),
    ]);
    return { superseded, onSeatPricing };
  }

  /** Cancels with proration unless Stripe already ended it, including by a parallel delivery. */
  private async cancelAtStripe(subscriptionId: string): Promise<void> {
    if (await this.endedAtStripe(subscriptionId)) return;

    try {
      await this.deps.stripeSubscriptions.cancelSubscription({ subscriptionId, prorate: true });
    } catch (err) {
      if (!(await this.endedAtStripe(subscriptionId))) throw err;
    }
  }

  /** A subscription Stripe no longer holds bills nothing, so it counts as ended. */
  private async endedAtStripe(subscriptionId: string): Promise<boolean> {
    try {
      const current = await this.deps.stripeSubscriptions.getSubscription({ subscriptionId });
      return ENDED_SUBSCRIPTION_STATUSES.has(current.status);
    } catch (err) {
      if (isResourceMissing(err)) return true;
      throw err;
    }
  }
}
