/**
 * Developer seats on a live Growth subscription: a separate line at the configured Developer
 * seat price. Adding charges the proration now; lowering moves the line from the next period
 * with no credit, and never below the Developers in use. Nothing is sold without a price.
 * @see specs/licensing/seat-buying.feature
 * @see specs/licensing/seat-quantity-floor.feature
 */
import {
  type BillingInterval,
  Currency,
  type DeveloperSeatQuote,
  type DeveloperSeats,
  DeveloperSeatsUnavailableError,
  developerSeatOfferFor,
  isDeveloperSeatPrice,
  isGrowthSeatPrice,
  NoActiveSubscriptionError,
  type StripePriceMap,
  SubscriptionItemNotFoundError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../repositories/seat-event-subscription.repository.ts";
import type {
  BillingSubscription,
  BillingSubscriptionChange,
} from "../rules/billing-stripe-shapes.rules.ts";
import { quotedAmounts, resolveProrationDate } from "../rules/seat-event-quote.rules.ts";
import { assertSeatsCoverUse } from "../rules/seat-floor.rules.ts";

/** The price per seat per period of a configured price id, in the minor unit. */
export type PriceUnitAmount = (priceId: string) => number | null;

/** Where the Developers in use are counted; the Developer line never goes below them. */
export type DevelopersInUseCounter = Pick<LicensingApi, "countDevelopersInUse">;

type DeveloperSeatServiceDeps = {
  stripeSubscriptions: StripeSubscriptionsChannel;
  subscriptions: SeatEventSubscriptionRepository;
  prices: StripePriceMap;
  unitAmountOf: PriceUnitAmount;
  seatsInUse: DevelopersInUseCounter;
};

type DeveloperLine = {
  subscription: BillingSubscription;
  priceId: string | undefined;
  unitAmountCents: number | null;
  current: { id: string; quantity: number } | undefined;
  currency: Currency;
  interval: BillingInterval;
};

export class DeveloperSeatService {
  private readonly stripeSubscriptions: StripeSubscriptionsChannel;
  private readonly subscriptions: SeatEventSubscriptionRepository;
  private readonly prices: StripePriceMap;
  private readonly unitAmountOf: PriceUnitAmount;
  private readonly seatsInUse: DevelopersInUseCounter;

  private constructor(deps: DeveloperSeatServiceDeps) {
    this.stripeSubscriptions = deps.stripeSubscriptions;
    this.subscriptions = deps.subscriptions;
    this.prices = deps.prices;
    this.unitAmountOf = deps.unitAmountOf;
    this.seatsInUse = deps.seatsInUse;
  }

  static create(deps: DeveloperSeatServiceDeps): DeveloperSeatService {
    return new DeveloperSeatService(deps);
  }

  async developerSeats({ organizationId }: { organizationId: string }): Promise<DeveloperSeats> {
    const line = await this.loadLine(organizationId);
    const available = line.priceId !== undefined && line.unitAmountCents !== null;
    return {
      available,
      quantity: line.current?.quantity ?? 0,
      unitAmountCents: available ? line.unitAmountCents : null,
      currency: line.currency,
      billingInterval: line.interval === "annual" ? "year" : "month",
      periodEndsAt:
        line.subscription.currentPeriodEnd == null
          ? null
          : line.subscription.currentPeriodEnd * 1000,
    };
  }

  async previewDeveloperSeats({
    organizationId,
    quantity,
  }: {
    organizationId: string;
    quantity: number;
  }): Promise<DeveloperSeatQuote> {
    const prorationDate = resolveProrationDate(undefined);
    const line = await this.loadLine(organizationId);
    const { priceId, unitAmountCents } = this.requireSold(line);
    const change = developerSeatChange({ line, priceId, quantity, prorationDate });
    const charged = change.prorationBehavior === "always_invoice";
    const preview = charged
      ? await this.stripeSubscriptions.previewInvoice({
          subscriptionId: line.subscription.id,
          change,
        })
      : null;
    const { prorationCents: amountDueCents, taxCents } = preview
      ? quotedAmounts(preview)
      : { prorationCents: 0, taxCents: 0 };
    const format = formatterFor(line.currency);
    return {
      amountDueCents,
      formattedAmountDue: format(amountDueCents),
      taxCents,
      formattedRecurringTotal: format(quantity * unitAmountCents),
      billingInterval: line.interval === "annual" ? "year" : "month",
      quotedAt: prorationDate,
    };
  }

  async setDeveloperSeats({
    organizationId,
    quantity,
    quotedAt,
  }: {
    organizationId: string;
    quantity: number;
    quotedAt?: number;
  }): Promise<{ success: true }> {
    const prorationDate = resolveProrationDate(quotedAt);
    const line = await this.loadLine(organizationId);
    const { priceId } = this.requireSold(line);
    if ((line.current?.quantity ?? 0) === quantity) return { success: true };
    const inUse = await this.seatsInUse.countDevelopersInUse({ organizationId });
    assertSeatsCoverUse({ seat: "developer", requested: quantity, inUse });
    await this.stripeSubscriptions.updateSubscription({
      subscriptionId: line.subscription.id,
      change: developerSeatChange({ line, priceId, quantity, prorationDate }),
    });
    return { success: true };
  }

  private requireSold(line: DeveloperLine): { priceId: string; unitAmountCents: number } {
    if (line.priceId === undefined || line.unitAmountCents === null) {
      throw new DeveloperSeatsUnavailableError();
    }
    return { priceId: line.priceId, unitAmountCents: line.unitAmountCents };
  }

  /** The live subscription, its currency and interval, and its Developer seat line if any. */
  private async loadLine(organizationId: string): Promise<DeveloperLine> {
    const candidates = await this.subscriptions.findSeatCandidates({ organizationId });
    const active = candidates.filter(
      (row) => row.status === SubscriptionStatus.ACTIVE && row.stripeSubscriptionId !== null,
    );
    const stripeSubscriptionId = active.length === 1 ? active[0]?.stripeSubscriptionId : null;
    if (!stripeSubscriptionId) throw new NoActiveSubscriptionError();

    const subscription = await this.stripeSubscriptions.getSubscription({
      subscriptionId: stripeSubscriptionId,
    });
    if (subscription.status !== "active") throw new NoActiveSubscriptionError();
    const seatItem = subscription.items.find((item) =>
      isGrowthSeatPrice(item.priceId, this.prices),
    );
    if (!seatItem) throw new SubscriptionItemNotFoundError("seat");

    const currency = subscription.currency?.toUpperCase() === "USD" ? Currency.USD : Currency.EUR;
    const interval: BillingInterval = seatItem.interval === "year" ? "annual" : "monthly";
    const offer = developerSeatOfferFor({ currency, interval, prices: this.prices });
    const priceId = offer.sold ? offer.priceId : undefined;
    const developerItem = subscription.items.find((item) =>
      isDeveloperSeatPrice(item.priceId, this.prices),
    );
    return {
      subscription,
      priceId,
      unitAmountCents: priceId ? this.unitAmountOf(priceId) : null,
      current: developerItem
        ? { id: developerItem.id, quantity: developerItem.quantity ?? 0 }
        : undefined,
      currency,
      interval,
    };
  }
}

/** The line change: added seats invoice now, fewer move from the next period, none removes it. */
function developerSeatChange({
  line,
  priceId,
  quantity,
  prorationDate,
}: {
  line: DeveloperLine;
  priceId: string;
  quantity: number;
  prorationDate: number;
}): BillingSubscriptionChange {
  const current = line.current;
  const lowering = quantity < (current?.quantity ?? 0);
  const item = developerLineItem({ current, priceId, quantity });
  return lowering
    ? { items: [item], prorationBehavior: "none" }
    : { items: [item], prorationBehavior: "always_invoice", prorationDate };
}

function developerLineItem({
  current,
  priceId,
  quantity,
}: {
  current: DeveloperLine["current"];
  priceId: string;
  quantity: number;
}) {
  if (!current) return { price: priceId, quantity };
  if (quantity === 0) return { id: current.id, deleted: true };
  return { id: current.id, quantity };
}

function formatterFor(currency: Currency) {
  return (cents: number) => {
    const amount = cents / 100;
    return new Intl.NumberFormat(currency === Currency.EUR ? "en-IE" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };
}
