import { isGrowthSeatPrice, type StripePriceMap } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  SeatEventSubscriptionRepository,
  SeatLineWriteRow,
  SeatRepairRow,
} from "../repositories/seat-event-subscription.repository.ts";
import type { BillingSubscription } from "../rules/billing-stripe-shapes.rules.ts";
import {
  SEAT_LINE_WRITE_TIMEOUT_MS,
  type SeatLineGuard,
  SeatLineLeaseService,
} from "./seat-line-lease.service.ts";

const logger = createLogger("langwatch:billing:seatLineRepair");

/** Failed repairs before the subscription is flagged to Ops; the pass keeps retrying after. */
export const SEAT_REPAIR_FLAG_AFTER_ATTEMPTS = 5;

/** Repairs younger than this are skipped: their seat change may still be running. */
export const SEAT_REPAIR_GRACE_MS = 5 * 60 * 1000;

/** Subscriptions Stripe ended: nothing bills next cycle, so there is nothing to put back. */
const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);
/** Subscriptions whose items Stripe refuses to change until the first payment lands. */
const UNCHANGEABLE_STATUSES = new Set(["incomplete"]);

/** What one repair pass did. */
export type SeatLineRepairOutcome = {
  repaired: number;
  /** Left for a later pass: Stripe cannot change the subscription yet, or a change holds it. */
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
  private readonly lease: SeatLineLeaseService;

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
    this.lease = SeatLineLeaseService.create({ subscriptions });
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
        // A seat change or another pass holding the line: this pass leaves it for the next.
        const held = await this.lease.hold({
          id: repair.id,
          waitMs: 0,
          work: (guard) => this.repair({ repair, guard }),
        });
        if (!held.held || held.value === "pending") {
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
    // Lifts first: a write left behind is then settled against the line as they left it.
    await this.settleWrites({ sentBefore: recordedBefore, outcome });
    return outcome;
  }

  /** Settles every write left pending past the grace window into `outcome`. */
  private async settleWrites({
    sentBefore,
    outcome,
  }: {
    sentBefore: Instant;
    outcome: SeatLineRepairOutcome;
  }): Promise<void> {
    for (const write of await this.subscriptions.findSeatLineWrites({ sentBefore })) {
      try {
        const held = await this.lease.hold({
          id: write.id,
          waitMs: 0,
          work: (guard) => this.settleWrite({ write, guard }),
        });
        if (!held.held || held.value === "pending") {
          outcome.pending += 1;
          continue;
        }
        outcome.repaired += 1;
      } catch (error) {
        outcome.failed += 1;
        if (await this.countWriteFailure({ write, error })) outcome.flagged += 1;
      }
    }
  }

  /**
   * Settles writes their holder never cleared. A seat change finished after them set the count;
   * otherwise a line at a count they wrote landed and stands, and any other line goes back to the
   * last finished change's count.
   */
  private async settleWrite({
    write,
    guard,
  }: {
    write: SeatLineWriteRow;
    guard: SeatLineGuard;
  }): Promise<"settled" | "pending"> {
    const pending = await this.subscriptions.findSeatLineWrite({ id: write.id });
    if (!pending?.since.equals(write.since)) return "settled";
    const settle = (accepted: number | null) =>
      this.subscriptions.settleSeatLineWrite({ id: write.id, since: write.since, accepted });
    const subscription = await this.stripeSubscriptions.getSubscription({
      subscriptionId: write.stripeSubscriptionId,
    });
    if (ENDED_STATUSES.has(subscription.status)) return settle(null).then(() => "settled");
    const seatItem = this.seatItemOf(subscription);
    const target = await this.subscriptions.findSeatLineTarget({ id: write.id });
    const changedSince = target.at !== null && Temporal.Instant.compare(target.at, write.since) > 0;
    const billed = seatItem.quantity;
    if (!changedSince && billed != null && pending.quantities.includes(billed)) {
      return settle(billed).then(() => "settled");
    }
    const quantity = target.quantity;
    if (quantity === null) throw new Error("The subscription has no seat count to settle to");
    if (seatItem.quantity !== quantity) {
      if (UNCHANGEABLE_STATUSES.has(subscription.status)) return "pending";
      await guard.write({
        quantity,
        send: () =>
          this.stripeSubscriptions.updateSubscription({
            subscriptionId: write.stripeSubscriptionId,
            change: { items: [{ id: seatItem.id, quantity }], prorationBehavior: "none" },
            timeoutMs: SEAT_LINE_WRITE_TIMEOUT_MS,
          }),
      });
    }
    await settle(null);
    return "settled";
  }

  /** Records a failed settle; answers whether this attempt raised the Ops flag. */
  private async countWriteFailure({
    write,
    error,
  }: {
    write: SeatLineWriteRow;
    error: unknown;
  }): Promise<boolean> {
    const attempts = write.attempts + 1;
    const raisesFlag = !write.flaggedAt && attempts >= SEAT_REPAIR_FLAG_AFTER_ATTEMPTS;
    const flaggedAt = write.flaggedAt ?? (raisesFlag ? nowInstant() : null);
    logger.error(
      { error, organizationId: write.organizationId, subscriptionId: write.stripeSubscriptionId },
      "seat line write left pending could not be settled; the next pass retries it",
    );
    await this.subscriptions
      .recordSeatLineWriteFailure({ id: write.id, since: write.since, attempts, flaggedAt })
      .catch((recordError: unknown) => {
        logger.error({ error: recordError, subscriptionId: write.id }, "seat write count failed");
      });
    return raisesFlag;
  }

  /** Moves the line back while Stripe still bills the lift; answers whether the record settles. */
  private async repair({
    repair,
    guard,
  }: {
    repair: SeatRepairRow;
    guard: SeatLineGuard;
  }): Promise<"settled" | "pending"> {
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
    const subscriptionId = repair.stripeSubscriptionId;
    await guard.write({
      quantity: repair.quantity,
      send: () =>
        this.stripeSubscriptions.updateSubscription({
          subscriptionId,
          change: {
            items: [{ id: seatItem.id, quantity: repair.quantity }],
            prorationBehavior: "none",
          },
          timeoutMs: SEAT_LINE_WRITE_TIMEOUT_MS,
        }),
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
