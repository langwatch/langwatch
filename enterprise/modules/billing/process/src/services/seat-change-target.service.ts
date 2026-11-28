import {
  AmbiguousSubscriptionError,
  isGrowthSeatPrice,
  NoActiveSubscriptionError,
  SeatChangeNeedsSupportError,
  SeatCheckoutRequiredError,
  type StripePriceMap,
  SubscriptionItemNotFoundError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  SeatEventSubscriptionRepository,
  SeatSubscriptionRow,
} from "../repositories/seat-event-subscription.repository.ts";
import { isCustomDeal } from "../rules/seat-checkout-guard.rules.ts";
import { planSeatChange, type SeatChangePlan, seatsKeptAt } from "../rules/seat-kept.rules.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import type { DuplicateSubscriptionAlerts } from "./duplicate-subscription-alert.service.ts";

const logger = createLogger("langwatch:billing:seatEventSubscription");

/** The audit actor for a correction billing makes on its own, with no operator behind it. */
const SELF_HEAL_ACTOR = "system:billing";

/** The subscription a seat change acts on, its provider record and its seat line. */
export type SeatChangeTarget = {
  subscription: LinkedSeatRow;
  stripeSubscription: ProviderSubscription;
  seatItem: ProviderSubscription["items"][number];
};

type LinkedSeatRow = SeatSubscriptionRow & { stripeSubscriptionId: string };
type ProviderSubscription = Awaited<ReturnType<StripeSubscriptionsChannel["getSubscription"]>>;

/** Finds the subscription a seat change acts on, and plans how a seat count reaches it. */
export class SeatChangeTargetService {
  private readonly stripeSubscriptions: StripeSubscriptionsChannel;
  private readonly subscriptions: SeatEventSubscriptionRepository;
  private readonly audit: Pick<BillingLifecycleAnnouncerService, "audited">;
  private readonly prices: StripePriceMap;
  private readonly duplicates: DuplicateSubscriptionAlerts;

  private constructor({
    stripeSubscriptions,
    subscriptions,
    audit,
    prices,
    duplicates,
  }: {
    stripeSubscriptions: StripeSubscriptionsChannel;
    subscriptions: SeatEventSubscriptionRepository;
    audit: Pick<BillingLifecycleAnnouncerService, "audited">;
    prices: StripePriceMap;
    duplicates: DuplicateSubscriptionAlerts;
  }) {
    this.stripeSubscriptions = stripeSubscriptions;
    this.subscriptions = subscriptions;
    this.audit = audit;
    this.prices = prices;
    this.duplicates = duplicates;
  }

  static create(options: {
    stripeSubscriptions: StripeSubscriptionsChannel;
    subscriptions: SeatEventSubscriptionRepository;
    audit: Pick<BillingLifecycleAnnouncerService, "audited">;
    prices: StripePriceMap;
    duplicates: DuplicateSubscriptionAlerts;
  }): SeatChangeTargetService {
    return new SeatChangeTargetService(options);
  }

  /**
   * The subscription a seat change should act on, or a named reason there isn't one.
   */
  async getSubscription(
    organizationId: string,
    { heal }: { heal: boolean } = { heal: false },
  ): Promise<LinkedSeatRow> {
    const candidates = await this.subscriptions.findSeatCandidates({ organizationId });

    const linked = (subscription: (typeof candidates)[number]) =>
      subscription.stripeSubscriptionId !== null;

    const active = candidates.filter((s) => s.status === SubscriptionStatus.ACTIVE);

    // Two active rows: when exactly one is live in Stripe, the others are local
    // rows nothing bills; a change closes them and goes on, a read just uses the live one.
    // Two live in Stripe, or a stray that is a custom deal, is for ops: refuse and tell them.
    if (active.length > 1) {
      const kept = await this.resolveStrayRows({ organizationId, active, heal });
      if (kept) return kept;

      const subscriptionIds = active.map((s) => s.id);
      logger.error(
        { organizationId, subscriptionIds, linkedCount: active.filter(linked).length },
        "[billing] Organization has multiple active subscriptions; refusing to guess which one a seat change belongs to",
      );
      await this.duplicates.reportDuplicateActive({ organizationId, subscriptionIds });

      throw new AmbiguousSubscriptionError(active.length);
    }

    // A live subscription we can act on beats everything.
    const activeLinked = candidates.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && linked(s),
    );
    if (activeLinked?.stripeSubscriptionId) {
      return {
        ...activeLinked,
        stripeSubscriptionId: activeLinked.stripeSubscriptionId,
      };
    }

    // An ACTIVE row with no link outranks any cancelled one: it is the
    // organization's current plan with nothing in Stripe to change, so the seats
    // go through Checkout, whose completion links this row (landOnLivePlan).
    const activeUnlinked = candidates.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && !linked(s),
    );
    if (activeUnlinked && isCustomDeal(activeUnlinked)) {
      logger.warn(
        { organizationId, subscriptionId: activeUnlinked.id },
        "[billing] Active subscription is a custom plan with no Stripe link; seats change through support",
      );
      throw new SeatChangeNeedsSupportError();
    }
    if (activeUnlinked) {
      logger.warn(
        { organizationId, subscriptionId: activeUnlinked.id },
        "[billing] Active subscription has no Stripe link; the seat change goes through checkout",
      );

      throw new SeatCheckoutRequiredError();
    }

    // Cancelled in our records but possibly still live at the provider —
    // updating seats is how a customer reverses a scheduled cancellation.
    const cancelledLinked = candidates.find((s) => linked(s));
    if (cancelledLinked?.stripeSubscriptionId) {
      return {
        ...cancelledLinked,
        stripeSubscriptionId: cancelledLinked.stripeSubscriptionId,
      };
    }

    throw new NoActiveSubscriptionError();
  }

  /**
   * The one ACTIVE row live in Stripe among several, or nothing when none or two are, or a stray
   * is a custom deal (the caller then refuses). With `heal` (a seat change) the strays are closed,
   * audited first; a read leaves them and asks Stripe only when two rows are linked.
   */
  private async resolveStrayRows({
    organizationId,
    active,
    heal,
  }: {
    organizationId: string;
    active: SeatSubscriptionRow[];
    heal: boolean;
  }): Promise<(SeatSubscriptionRow & { stripeSubscriptionId: string }) | null> {
    const linkedRows = active.flatMap((row) =>
      row.stripeSubscriptionId === null
        ? []
        : [{ ...row, stripeSubscriptionId: row.stripeSubscriptionId }],
    );
    const live: (SeatSubscriptionRow & { stripeSubscriptionId: string })[] = [];
    for (const row of linkedRows) {
      if (linkedRows.length === 1 && !heal) live.push(row);
      else if (await this.isLiveInStripe(row.stripeSubscriptionId)) live.push(row);
    }
    const [kept] = live;
    if (!kept || live.length > 1) return null;

    const strays = active.filter((row) => row.id !== kept.id);
    if (strays.some(isCustomDeal)) return null;
    if (!heal) return kept;

    const strayIds = strays.map((row) => row.id);
    try {
      await this.audit.audited({
        tenantId: organizationId,
        userId: SELF_HEAL_ACTOR,
        action: "subscription.supersedeStrayRows",
        args: { keptId: kept.id, strayIds },
        targetKind: "organization",
        targetId: organizationId,
      });
    } catch (error) {
      logger.error(
        { error, organizationId },
        "[billing] Could not audit closing stray subscriptions",
      );
      return null;
    }
    await this.subscriptions.supersedeStrayRows({ ids: strayIds });
    logger.warn(
      { organizationId, keptId: kept.id, strayIds },
      "[billing] Closed active subscriptions with no live Stripe subscription beside the live one",
    );
    return kept;
  }

  /** Whether Stripe still bills this subscription; an unreadable one counts as live, to refuse. */
  private async isLiveInStripe(stripeSubscriptionId: string): Promise<boolean> {
    try {
      const { status } = await this.stripeSubscriptions.getSubscription({
        subscriptionId: stripeSubscriptionId,
      });
      return status !== "canceled" && status !== "incomplete_expired";
    } catch {
      return true;
    }
  }

  /** The subscription, its provider record, and the seat line to change. */
  async load(
    organizationId: string,
    options: { heal: boolean } = { heal: false },
  ): Promise<SeatChangeTarget> {
    const subscription = await this.getSubscription(organizationId, options);

    const stripeSubscription = await this.stripeSubscriptions.getSubscription({
      subscriptionId: subscription.stripeSubscriptionId,
    });

    // Must still be live at the provider, even if scheduled for cancellation or behind on a
    // payment: a past due subscription can still drop seats, and adding them is held upstream.
    if (stripeSubscription.status !== "active" && stripeSubscription.status !== "past_due") {
      throw new NoActiveSubscriptionError();
    }

    const seatItem = stripeSubscription.items.find((item) =>
      isGrowthSeatPrice(item.priceId, this.prices),
    );

    if (!seatItem) {
      throw new SubscriptionItemNotFoundError("seat");
    }

    return { subscription, stripeSubscription, seatItem };
  }

  /** How a requested seat count reaches the provider, from what it bills and keeps now. */
  plan({ target, requested }: { target: SeatChangeTarget; requested: number }): SeatChangePlan {
    const { subscription, stripeSubscription, seatItem } = target;
    const billed = seatItem.quantity ?? subscription.maxMembers ?? 0;
    const keptSeats = seatsKeptAt({
      seatsKept: subscription.seatsKept,
      seatsKeptUntil: subscription.seatsKeptUntil,
      now: nowInstant(),
    });
    const periodEnd = stripeSubscription.currentPeriodEnd;
    if (periodEnd == null) {
      throw new SubscriptionItemNotFoundError("current_period_end");
    }

    return planSeatChange({
      billed,
      keptSeats,
      keptUntil: subscription.seatsKeptUntil,
      requested,
      periodEnd: Temporal.Instant.fromEpochMilliseconds(periodEnd * 1000),
    });
  }
}
