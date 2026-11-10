// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Retires the tiered subscriptions a Growth seat subscription supersedes, run by the lifecycle
 * pipeline's outbox. Safe to run again: Stripe's own status says what is already cancelled.
 * Spec: enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { isGrowthSeatEventPlan, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  BillingWebhookSubscriptionRepository,
  SupersededSubscription,
} from "../repositories/billing-webhook-subscription.repository.ts";
import { ENDED_SUBSCRIPTION_STATUSES } from "../rules/billing-stripe-shapes.rules.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";

const logger = createLogger("langwatch:billing:tieredPlanRetirement");

type TieredPlanRetirementDeps = Readonly<{
  subscriptions: Pick<
    BillingWebhookSubscriptionRepository,
    "findByStripeId" | "findSupersededBySeatEvent" | "cancel"
  >;
  stripeSubscriptions: Pick<StripeSubscriptionsChannel, "getSubscription" | "cancelSubscription">;
  facts: Pick<BillingLifecycleAnnouncerService, "pricingModelChanged">;
}>;

export class TieredPlanRetirementService {
  static create(deps: TieredPlanRetirementDeps): TieredPlanRetirementService {
    return new TieredPlanRetirementService(deps);
  }

  private constructor(private readonly deps: TieredPlanRetirementDeps) {}

  /** Throws when any retirement fails, so the outbox retries; the rest are still attempted. */
  async retireTieredPlans({
    organizationId,
    seatStripeSubscriptionId,
  }: {
    organizationId: string;
    seatStripeSubscriptionId: string;
  }): Promise<void> {
    const seat = await this.deps.subscriptions.findByStripeId(seatStripeSubscriptionId);
    if (
      !seat ||
      seat.organizationId !== organizationId ||
      seat.status !== SubscriptionStatus.ACTIVE ||
      !isGrowthSeatEventPlan(seat.plan)
    ) {
      logger.info(
        { organizationId, seatStripeSubscriptionId, status: seat?.status ?? null },
        "No active Growth seat subscription to retire tiered plans for",
      );
      return;
    }

    const superseded = await this.deps.subscriptions.findSupersededBySeatEvent({
      organizationId,
      excludeSubscriptionId: seat.id,
    });
    if (superseded.length === 0) return;

    await this.deps.facts.pricingModelChanged({ organizationId, pricingModel: "SEAT_EVENT" });

    const failures: unknown[] = [];
    for (const subscription of superseded) {
      try {
        await this.retire(subscription);
      } catch (error) {
        logger.error(
          { organizationId, stripeSubscriptionId: subscription.stripeSubscriptionId, error },
          "Retiring a superseded tiered subscription failed; the outbox retries it",
        );
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${failures.length} superseded tiered subscription(s) were not retired`,
      );
    }
  }

  /** Cancels at Stripe unless it has already ended there, then records the cancellation. */
  private async retire({ id, stripeSubscriptionId }: SupersededSubscription): Promise<void> {
    if (stripeSubscriptionId) {
      const atStripe = await this.deps.stripeSubscriptions.getSubscription({
        subscriptionId: stripeSubscriptionId,
      });
      if (!ENDED_SUBSCRIPTION_STATUSES.has(atStripe.status)) {
        await this.deps.stripeSubscriptions.cancelSubscription({
          subscriptionId: stripeSubscriptionId,
          prorate: true,
        });
      }
    }
    await this.deps.subscriptions.cancel({ id });
  }
}
