import {
  AmbiguousSubscriptionError,
  Currency,
  type Currency as CurrencyType,
  type BillingInterval,
  createCheckoutLineItems,
  isGrowthSeatPrice,
  NoActiveSubscriptionError,
  resolveGrowthSeatPlanType,
  SeatChangeBusyError,
  type StripePriceMap,
  SubscriptionItemNotFoundError,
  SubscriptionNotLinkedError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../repositories/seat-event-subscription.repository.ts";
import {
  chargedAmounts,
  type SeatEventProrationQuote,
  resolveProrationDate,
  seatChange,
} from "../rules/seat-event-quote.rules.ts";
import { planSeatChange, type SeatChangePlan, seatsKeptAt } from "../rules/seat-kept.rules.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import { SeatCheckoutSessionService } from "./seat-checkout-session.service.ts";
import { type SeatLineGuard, SeatLineLeaseService } from "./seat-line-lease.service.ts";
import { SeatLineMoveService } from "./seat-line-move.service.ts";
import type { StripeCustomerCurrencyService } from "./stripe-customer-currency.service.ts";

const logger = createLogger("langwatch:billing:seatEventSubscription");

/** How long a seat change waits for another change or a repair on the same subscription. */
const SEAT_CHANGE_WAIT_MS = 15_000;

export class SeatEventSubscriptionService {
  private readonly stripeSubscriptions: StripeSubscriptionsChannel;
  private readonly subscriptions: SeatEventSubscriptionRepository;
  private readonly abandoned: Pick<BillingLifecycleAnnouncerService, "seatCheckoutsAbandoned">;
  private readonly prices: StripePriceMap;
  private readonly customerCurrency: StripeCustomerCurrencyService;
  private readonly seatLine: SeatLineMoveService;
  private readonly lease: SeatLineLeaseService;
  private readonly checkoutSessions: SeatCheckoutSessionService;

  private constructor({
    stripeSubscriptions,
    subscriptions,
    abandoned,
    prices,
    customerCurrency,
  }: {
    stripeSubscriptions: StripeSubscriptionsChannel;
    subscriptions: SeatEventSubscriptionRepository;
    abandoned: Pick<BillingLifecycleAnnouncerService, "seatCheckoutsAbandoned">;
    prices: StripePriceMap;
    customerCurrency: StripeCustomerCurrencyService;
  }) {
    this.stripeSubscriptions = stripeSubscriptions;
    this.subscriptions = subscriptions;
    this.abandoned = abandoned;
    this.prices = prices;
    this.customerCurrency = customerCurrency;
    this.seatLine = SeatLineMoveService.create({ stripeSubscriptions, subscriptions });
    this.lease = SeatLineLeaseService.create({ subscriptions });
    this.checkoutSessions = SeatCheckoutSessionService.create({ stripeSubscriptions });
  }

  static create(options: {
    stripeSubscriptions: StripeSubscriptionsChannel;
    subscriptions: SeatEventSubscriptionRepository;
    abandoned: Pick<BillingLifecycleAnnouncerService, "seatCheckoutsAbandoned">;
    prices: StripePriceMap;
    customerCurrency: StripeCustomerCurrencyService;
  }): SeatEventSubscriptionService {
    return new SeatEventSubscriptionService(options);
  }

  /**
   * The subscription a seat change should act on, or a named reason there isn't one.
   */
  private async findSeatSubscription(organizationId: string) {
    const candidates = await this.subscriptions.findSeatCandidates({ organizationId });

    const linked = (subscription: (typeof candidates)[number]) =>
      subscription.stripeSubscriptionId !== null;

    const active = candidates.filter((s) => s.status === SubscriptionStatus.ACTIVE);

    // Two live plans on one account: refuse, do not choose. There is no unique
    // index on `organizationId`, and the admin console form writes ACTIVE rows
    // with no uniqueness check, so this state is reachable and the row that
    // still carries a provider id is not reliably the one the operator meant
    // to keep. Charging either is a coin flip against a customer's card.
    if (active.length > 1) {
      logger.error(
        {
          organizationId,
          subscriptionIds: active.map((s) => s.id),
          linkedCount: active.filter(linked).length,
        },
        "[billing] Organization has multiple active subscriptions; refusing to guess which one a seat change belongs to",
      );

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
    // organization's current plan, and it is the state only an operator can
    // clear (nothing but the checkout webhook ever writes the link).
    const activeUnlinked = candidates.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && !linked(s),
    );
    if (activeUnlinked) {
      logger.error(
        { organizationId, subscriptionId: activeUnlinked.id },
        "[billing] Active subscription has no billing-provider link; seat changes need one to be connected by hand",
      );

      throw new SubscriptionNotLinkedError();
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

  /** The subscription, its provider record, and the seat line to change. */
  private async loadSeatChangeTarget(organizationId: string) {
    const subscription = await this.findSeatSubscription(organizationId);

    const stripeSubscription = await this.stripeSubscriptions.getSubscription({
      subscriptionId: subscription.stripeSubscriptionId,
    });

    // Must still be live at the provider, even if scheduled for cancellation.
    if (stripeSubscription.status !== "active") {
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

  // An arrow instance property, not a prototype method: tests hold a mock
  // cast `as unknown as SeatEventSubscriptionService` and assert on this
  // member unbound (`expect(seatEventService.createSeatEventCheckout)...`),
  // which is unsafe against a method-shorthand member.
  createSeatEventCheckout = async ({
    organizationId,
    customerId,
    baseUrl,
    currency,
    billingInterval,
    membersToAdd,
    isUpgradeFromTiered = false,
    startedByUserId,
  }: {
    organizationId: string;
    customerId: string;
    baseUrl: string;
    currency: CurrencyType;
    billingInterval: BillingInterval;
    membersToAdd: number;
    isUpgradeFromTiered?: boolean;
    startedByUserId?: string;
  }): Promise<{ url: string | null; subscriptionId: string }> => {
    // Resolve the currency before touching the database. A checkout we cannot
    // build in the customer's own currency will be rejected outright, and every
    // write below this point would have to be cleaned up afterwards.
    const checkoutCurrency = this.customerCurrency.getCurrency(
      await this.customerCurrency.resolve({
        customerId,
        organizationId,
        requestedCurrency: currency,
      }),
    );

    await this.cancelAbandonedCheckouts(organizationId);

    // Build line items BEFORE persisting anything so a validation failure
    // doesn't leave orphaned pending records in the database.
    const lineItems = createCheckoutLineItems({
      coreMembers: membersToAdd,
      currency: checkoutCurrency,
      interval: billingInterval,
      prices: this.prices,
    });

    const subscription = await this.createPendingSubscription({
      organizationId,
      membersToAdd,
      checkoutCurrency,
      billingInterval,
    });

    const { url } = await this.checkoutSessions.open({
      customerId,
      baseUrl,
      checkoutCurrency,
      billingInterval,
      lineItems,
      isUpgradeFromTiered,
      subscriptionId: subscription.id,
      ...(startedByUserId ? { startedByUserId } : {}),
    });
    return { url, subscriptionId: subscription.id };
  };

  /**
   * Cancels the PENDING subscriptions abandoned checkouts left behind, and the
   * PAYMENT_PENDING invites that hung off them.
   */
  private async cancelAbandonedCheckouts(organizationId: string): Promise<void> {
    const staleSubIds = await this.subscriptions.cancelPendingSeatCheckouts({ organizationId });
    if (staleSubIds.length === 0) return;
    await this.abandoned.seatCheckoutsAbandoned({ organizationId, subscriptionIds: staleSubIds });
  }

  /** The pending subscription; organization holds a checkout's invites against its id (C2 A). */
  private async createPendingSubscription({
    organizationId,
    membersToAdd,
    checkoutCurrency,
    billingInterval,
  }: {
    organizationId: string;
    membersToAdd: number;
    checkoutCurrency: Currency;
    billingInterval: BillingInterval;
  }): Promise<{ id: string }> {
    const subscription = await this.subscriptions.createPendingSeatCheckout({
      organizationId,
      plan: resolveGrowthSeatPlanType({ currency: checkoutCurrency, interval: billingInterval }),
      maxMembers: membersToAdd,
    });
    return subscription;
  }

  async updateSeatEventItems({
    organizationId,
    totalMembers,
    quotedAt,
  }: {
    organizationId: string;
    totalMembers: number;
    /**
     * The instant a quote for this change was priced, from
     * {@link previewProration}. Omitted by callers acting without a quote on
     * screen, which are then priced at the moment they run.
     */
    quotedAt?: number;
  }): Promise<{ success: true }> {
    // Every failure below throws: a silent `{ success: false }` once resolved as a success.
    // First, so an expired quote is refused before the provider is touched.
    const prorationDate = resolveProrationDate(quotedAt);

    // One change or repair at a time per subscription, from its Stripe read to its last write.
    const found = await this.findSeatSubscription(organizationId);
    const held = await this.lease.hold({
      id: found.id,
      waitMs: SEAT_CHANGE_WAIT_MS,
      work: (guard) =>
        this.changeSeats({ organizationId, leased: found.id, totalMembers, prorationDate, guard }),
    });
    if (!held.held) throw new SeatChangeBusyError();

    return { success: true };
  }

  /** The seat change itself, run while it holds the subscription's seat line. */
  private async changeSeats({
    organizationId,
    leased,
    totalMembers,
    prorationDate,
    guard,
  }: {
    organizationId: string;
    /** The subscription whose seat line lease this change holds. */
    leased: string;
    totalMembers: number;
    prorationDate: number;
    guard: SeatLineGuard;
  }): Promise<void> {
    // Read again under the lease: a change it waited behind may have moved the seats it keeps.
    const target = await this.loadSeatChangeTarget(organizationId);
    if (target.subscription.id !== leased) throw new SeatChangeBusyError();
    const { subscription, stripeSubscription, seatItem } = target;
    const plan = this.planChange({ target, requested: totalMembers });

    // Kept seats are recorded first: a provider webhook lowering the count before the final
    // write still finds the seats paid for, and a retry recomputes the same plan.
    if (plan.kept) await this.subscriptions.keepSeats({ id: subscription.id, kept: plan.kept });

    // An increase charges the proration now; a decrease applies from the next cycle with
    // no credit. Either reactivates a subscription scheduled for cancellation.
    const { repairsUpTo } = await this.seatLine.move({
      id: subscription.id,
      organizationId,
      stripeSubscription,
      seatItem,
      billed: seatItem.quantity ?? subscription.maxMembers ?? 0,
      plan,
      prorationDate,
      guard,
    });

    await this.subscriptions.reactivateWithSeats({
      id: subscription.id,
      maxMembers: totalMembers,
      kept: plan.kept,
      repairsUpTo,
    });
  }

  /** How a requested seat count reaches the provider, from what it bills and keeps now. */
  private planChange({
    target,
    requested,
  }: {
    target: Awaited<ReturnType<SeatEventSubscriptionService["loadSeatChangeTarget"]>>;
    requested: number;
  }): SeatChangePlan {
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

  // An arrow instance property, not a prototype method: tests hold a mock
  // cast `as unknown as SeatEventSubscriptionService` and assert on this
  // member unbound (`expect(seatEventService.previewProration)...`), which is
  // unsafe against a method-shorthand member.
  previewProration = async ({
    organizationId,
    newTotalSeats,
  }: {
    organizationId: string;
    newTotalSeats: number;
  }): Promise<SeatEventProrationQuote> => {
    const prorationDate = resolveProrationDate(undefined);

    const target = await this.loadSeatChangeTarget(organizationId);
    const { subscription, stripeSubscription, seatItem } = target;
    const plan = this.planChange({ target, requested: newTotalSeats });

    // Recurring total: new seat count × per-seat price.
    const unitAmountCents = seatItem.unitAmount;
    if (unitAmountCents === null) {
      throw new SubscriptionItemNotFoundError("seat_unit_amount");
    }

    const charged = plan.steps.find((step) => step.prorationBehavior === "always_invoice");
    // Preview the exact charged change the confirm button performs, through the Create
    // Preview Invoice API (the Upcoming Invoice API rejects flexible billing mode).
    const previewAt = (quantity: number) =>
      this.stripeSubscriptions.previewInvoice({
        subscriptionId: subscription.stripeSubscriptionId,
        change: seatChange({ subscription: stripeSubscription, seatItem, quantity, prorationDate }),
      });
    const preview = charged ? await previewAt(charged.quantity) : null;
    // With a lift step, the move to the seats paid for separates them from carried prorations.
    const lifted =
      preview && plan.chargedShare
        ? await previewAt(newTotalSeats - plan.chargedShare.added)
        : null;

    const currency = (
      preview?.currency ??
      stripeSubscription.currency ??
      Currency.USD
    ).toUpperCase() as CurrencyType;
    const billingInterval = seatItem.interval ?? "month";

    const { prorationCents, creditAppliedCents, taxCents } = preview
      ? chargedAmounts({ preview, lifted, share: plan.chargedShare })
      : { prorationCents: 0, creditAppliedCents: 0, taxCents: 0 };

    const format = (cents: number) => {
      const amount = cents / 100;

      return new Intl.NumberFormat(currency === Currency.EUR ? "en-IE" : "en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(amount);
    };

    return {
      amountDueCents: prorationCents,
      formattedAmountDue: format(prorationCents),
      // Null rather than a formatted zero: say nothing about credit on an account with none.
      formattedCreditApplied: creditAppliedCents > 0 ? format(creditAppliedCents) : null,
      taxCents,
      formattedAmountDueExcludingTax: taxCents > 0 ? format(prorationCents - taxCents) : null,
      formattedTax: taxCents > 0 ? format(taxCents) : null,
      formattedRecurringTotal: format(newTotalSeats * unitAmountCents),
      billingInterval,
      // The instant this quote priced, sent back on confirm so the charge matches it.
      quotedAt: prorationDate,
      appliesAt: plan.appliesAt?.epochMilliseconds ?? null,
      keptSeats: plan.kept?.seats ?? null,
      formattedKeptRecurringTotal: plan.kept ? format(plan.kept.seats * unitAmountCents) : null,
    };
  };

  async seatEventBillingPortalUrl({
    customerId,
    baseUrl,
  }: {
    customerId: string;
    baseUrl: string;
  }): Promise<{ url: string }> {
    return this.stripeSubscriptions.createBillingPortalSession({
      customerId,
      returnUrl: `${baseUrl}/settings/subscription`,
    });
  }
}
