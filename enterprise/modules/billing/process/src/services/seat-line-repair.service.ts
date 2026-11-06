import { isGrowthSeatPrice, type StripePriceMap } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  SeatEventSubscriptionRepository,
  SeatRepairRow,
} from "../repositories/seat-event-subscription.repository.ts";

const logger = createLogger("langwatch:billing:seatLineRepair");

/** Failed repairs before the subscription is flagged to Ops; the pass keeps retrying after. */
export const SEAT_REPAIR_FLAG_AFTER_ATTEMPTS = 5;

/** What one repair pass did. */
export type SeatLineRepairOutcome = {
  repaired: number;
  failed: number;
  flagged: number;
};

/**
 * Puts a seat line back to the quantity recorded when Stripe refused the rollback after a lift
 * (specs/licensing/seat-rotation.feature), with no proration, so the next cycle bills as before.
 */
export class SeatLineRepairService {
  private readonly stripeSubscriptions: Pick<
    StripeSubscriptionsChannel,
    "getSubscription" | "updateSubscription"
  >;
  private readonly subscriptions: SeatEventSubscriptionRepository;
  private readonly prices: StripePriceMap;

  private constructor({
    stripeSubscriptions,
    subscriptions,
    prices,
  }: {
    stripeSubscriptions: Pick<StripeSubscriptionsChannel, "getSubscription" | "updateSubscription">;
    subscriptions: SeatEventSubscriptionRepository;
    prices: StripePriceMap;
  }) {
    this.stripeSubscriptions = stripeSubscriptions;
    this.subscriptions = subscriptions;
    this.prices = prices;
  }

  static create(options: {
    stripeSubscriptions: Pick<StripeSubscriptionsChannel, "getSubscription" | "updateSubscription">;
    subscriptions: SeatEventSubscriptionRepository;
    prices: StripePriceMap;
  }): SeatLineRepairService {
    return new SeatLineRepairService(options);
  }

  /** One pass over every pending repair; one failure never stops the next. */
  async repairSeatLines(): Promise<SeatLineRepairOutcome> {
    const outcome: SeatLineRepairOutcome = { repaired: 0, failed: 0, flagged: 0 };
    for (const repair of await this.subscriptions.findSeatRepairs()) {
      try {
        await this.repair(repair);
        await this.subscriptions.clearSeatRepair({ id: repair.id, quantity: repair.quantity });
        outcome.repaired += 1;
      } catch (error) {
        outcome.failed += 1;
        if (await this.countFailure({ repair, error })) outcome.flagged += 1;
      }
    }
    return outcome;
  }

  /** Moves the line unless Stripe already bills the intended quantity or the subscription ended. */
  private async repair(repair: SeatRepairRow): Promise<void> {
    const subscription = await this.stripeSubscriptions.getSubscription({
      subscriptionId: repair.stripeSubscriptionId,
    });
    if (subscription.status !== "active") return;
    const seatItem = subscription.items.find((item) =>
      isGrowthSeatPrice(item.priceId, this.prices),
    );
    if (!seatItem) throw new Error("The subscription has no Growth seat line");
    if (seatItem.quantity === repair.quantity) return;
    await this.stripeSubscriptions.updateSubscription({
      subscriptionId: repair.stripeSubscriptionId,
      change: {
        items: [{ id: seatItem.id, quantity: repair.quantity }],
        prorationBehavior: "none",
      },
    });
  }

  /** Records the failed attempt; answers whether this attempt raised the Ops flag. */
  private async countFailure({
    repair,
    error,
  }: {
    repair: SeatRepairRow;
    error: unknown;
  }): Promise<boolean> {
    const attempts = repair.attempts + 1;
    const raisesFlag = !repair.flaggedAt && attempts >= SEAT_REPAIR_FLAG_AFTER_ATTEMPTS;
    const flaggedAt = repair.flaggedAt ?? (raisesFlag ? nowInstant() : null);
    logger.error(
      {
        error,
        organizationId: repair.organizationId,
        subscriptionId: repair.stripeSubscriptionId,
        quantity: repair.quantity,
        attempts,
        flagged: flaggedAt !== null,
      },
      "seat line repair failed; the next pass retries it",
    );
    await this.subscriptions
      .recordSeatRepairFailure({ id: repair.id, quantity: repair.quantity, attempts, flaggedAt })
      .catch((recordError: unknown) => {
        logger.error({ error: recordError, subscriptionId: repair.id }, "seat repair count failed");
      });
    return raisesFlag;
  }
}
