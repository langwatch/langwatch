import { isGrowthSeatPrice, type StripePriceMap } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  SeatEventSubscriptionRepository,
  SeatRepairRow,
} from "../repositories/seat-event-subscription.repository.ts";
import type { BillingSubscription } from "../rules/billing-stripe-shapes.rules.ts";

const logger = createLogger("langwatch:billing:seatLineRepair");

/** Failed repairs before the subscription is flagged to Ops; the pass keeps retrying after. */
export const SEAT_REPAIR_FLAG_AFTER_ATTEMPTS = 5;

/**
 * Repairs younger than this are skipped: their seat change may still be running. A change whose
 * Stripe calls outlast it can still be raced; Stripe's client gives up on a call well before.
 */
export const SEAT_REPAIR_GRACE_MS = 5 * 60 * 1000;

/** Subscriptions Stripe ended: nothing bills next cycle, so there is nothing to put back. */
const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);
/** Subscriptions whose items Stripe refuses to change until the first payment lands. */
const UNCHANGEABLE_STATUSES = new Set(["incomplete"]);

/** What one repair pass did. */
export type SeatLineRepairOutcome = {
  repaired: number;
  /** Left for a later pass: Stripe cannot change the subscription yet. */
  pending: number;
  failed: number;
  flagged: number;
};

/**
 * Puts a line a seat change left lifted back to the recorded quantity with no proration
 * (specs/licensing/seat-rotation.feature). Only a line still at the recorded lift moves; any other
 * count is a charge that went through or a later change, cleared without touching Stripe.
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

  /** One pass over every pending repair past the grace window; one failure never stops the next. */
  async repairSeatLines(): Promise<SeatLineRepairOutcome> {
    const outcome: SeatLineRepairOutcome = { repaired: 0, pending: 0, failed: 0, flagged: 0 };
    const recordedBefore = nowInstant().subtract({ milliseconds: SEAT_REPAIR_GRACE_MS });
    for (const repair of await this.subscriptions.findSeatRepairs({ recordedBefore })) {
      try {
        if ((await this.repair(repair)) === "pending") {
          outcome.pending += 1;
          continue;
        }
        await this.subscriptions.clearSeatRepair({ id: repair.id, record: repair });
        outcome.repaired += 1;
      } catch (error) {
        outcome.failed += 1;
        if (await this.countFailure({ repair, error })) outcome.flagged += 1;
      }
    }
    return outcome;
  }

  /** Moves the line back while Stripe still bills the lift; answers whether the record settles. */
  private async repair(repair: SeatRepairRow): Promise<"settled" | "pending"> {
    // A seat change since the pass read the list replaced or cleared this record: leave it.
    if (!(await this.subscriptions.isSeatRepairPending({ id: repair.id, record: repair }))) {
      return "settled";
    }
    // Read last, right before the update, so the quantity checked is Stripe's current one.
    const subscription = await this.stripeSubscriptions.getSubscription({
      subscriptionId: repair.stripeSubscriptionId,
    });
    if (ENDED_STATUSES.has(subscription.status)) return "settled";
    const seatItem = this.seatItemOf(subscription);
    if (seatItem.quantity !== repair.liftedQuantity) return "settled";
    if (UNCHANGEABLE_STATUSES.has(subscription.status)) return "pending";
    await this.stripeSubscriptions.updateSubscription({
      subscriptionId: repair.stripeSubscriptionId,
      change: {
        items: [{ id: seatItem.id, quantity: repair.quantity }],
        prorationBehavior: "none",
      },
    });
    return "settled";
  }

  private seatItemOf(subscription: BillingSubscription) {
    const seatItem = subscription.items.find((item) =>
      isGrowthSeatPrice(item.priceId, this.prices),
    );
    if (!seatItem) throw new Error("The subscription has no Growth seat line");
    return seatItem;
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
      .recordSeatRepairFailure({ id: repair.id, record: repair, attempts, flaggedAt })
      .catch((recordError: unknown) => {
        logger.error({ error: recordError, subscriptionId: repair.id }, "seat repair count failed");
      });
    return raisesFlag;
  }
}
