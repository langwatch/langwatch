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
  SeatChangeNeedsSupportError,
  SeatCheckoutRequiredError,
  type StripePriceMap,
  SubscriptionItemNotFoundError,
  SubscriptionAlreadyActiveError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  SeatEventSubscriptionRepository,
  SeatSubscriptionRow,
} from "../repositories/seat-event-subscription.repository.ts";
import { blocksSeatCheckout, isCustomDeal } from "../rules/seat-checkout-guard.rules.ts";
import {
  chargedAmounts,
  type SeatEventProrationQuote,
  resolveProrationDate,
  seatChange,
} from "../rules/seat-event-quote.rules.ts";
import { planSeatChange, type SeatChangePlan, seatsKeptAt } from "../rules/seat-kept.rules.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import type { DuplicateSubscriptionAlerts } from "./duplicate-subscription-alert.service.ts";
import { SeatCheckoutSessionService } from "./seat-checkout-session.service.ts";
import { type SeatLineGuard, SeatLineLeaseService } from "./seat-line-lease.service.ts";
import { SeatLineMoveService } from "./seat-line-move.service.ts";
import type { StripeCustomerCurrencyService } from "./stripe-customer-currency.service.ts";

const logger = createLogger("langwatch:billing:seatEventSubscription");

/** The audit actor for a correction billing makes on its own, with no operator behind it. */
const SELF_HEAL_ACTOR = "system:billing";

/** How long a seat change waits for another change or a repair on the same subscription. */
const SEAT_CHANGE_WAIT_MS = 15_000;

export class SeatEventSubscriptionService {
  private readonly stripeSubscriptions: StripeSubscriptionsChannel;
  private readonly subscriptions: SeatEventSubscriptionRepository;
  private readonly abandoned: Pick<
    BillingLifecycleAnnouncerService,
    "seatCheckoutsAbandoned" | "audited"
  >;
  private readonly prices: StripePriceMap;
  private readonly customerCurrency: StripeCustomerCurrencyService;
  private readonly seatLine: SeatLineMoveService;
  private readonly lease: SeatLineLeaseService;
  private readonly checkoutSessions: SeatCheckoutSessionService;
  private readonly duplicates: DuplicateSubscriptionAlerts;

  private constructor({
    stripeSubscriptions,
    subscriptions,
    abandoned,
    prices,
    customerCurrency,
    duplicates,
  }: {
    stripeSubscriptions: StripeSubscriptionsChannel;
    subscriptions: SeatEventSubscriptionRepository;
    abandoned: Pick<BillingLifecycleAnnouncerService, "seatCheckoutsAbandoned" | "audited">;
    prices: StripePriceMap;
    customerCurrency: StripeCustomerCurrencyService;
    duplicates: DuplicateSubscriptionAlerts;
  }) {
    this.stripeSubscriptions = stripeSubscriptions;
    this.subscriptions = subscriptions;
    this.abandoned = abandoned;
    this.prices = prices;
    this.customerCurrency = customerCurrency;
    this.duplicates = duplicates;
    this.seatLine = SeatLineMoveService.create({ stripeSubscriptions, subscriptions });
    this.lease = SeatLineLeaseService.create({ subscriptions });
    this.checkoutSessions = SeatCheckoutSessionService.create({ stripeSubscriptions });
  }

  static create(options: {
    stripeSubscriptions: StripeSubscriptionsChannel;
    subscriptions: SeatEventSubscriptionRepository;
    abandoned: Pick<BillingLifecycleAnnouncerService, "seatCheckoutsAbandoned" | "audited">;
    prices: StripePriceMap;
    customerCurrency: StripeCustomerCurrencyService;
    /** Ops hear about an organization with more than one active subscription. */
    duplicates: DuplicateSubscriptionAlerts;
  }): SeatEventSubscriptionService {
    return new SeatEventSubscriptionService(options);
  }

  /**
   * The subscription a seat change should act on, or a named reason there isn't one.
   */
  private async findSeatSubscription(
    organizationId: string,
    { heal }: { heal: boolean } = { heal: false },
  ) {
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
      await this.abandoned.audited({
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
  private async loadSeatChangeTarget(
    organizationId: string,
    options: { heal: boolean } = { heal: false },
  ) {
    const subscription = await this.findSeatSubscription(organizationId, options);

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
    retentionDays,
    successPath,
  }: {
    organizationId: string;
    customerId: string;
    baseUrl: string;
    currency: CurrencyType;
    billingInterval: BillingInterval;
    membersToAdd: number;
    isUpgradeFromTiered?: boolean;
    startedByUserId?: string;
    /** Where the checkout returns instead of the subscription page. */
    successPath?: string;
    /** Kept on the pending row; data-retention sets it on the organization once it is paid. */
    retentionDays?: number;
  }): Promise<{ url: string | null; subscriptionId: string }> => {
    await this.refuseBesideLivePlan(organizationId);

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

    await this.cancelAbandonedCheckouts({ organizationId, customerId });

    // Build line items BEFORE persisting anything so a validation failure
    // doesn't leave orphaned pending records in the database.
    const lineItems = createCheckoutLineItems({
      coreMembers: membersToAdd,
      currency: checkoutCurrency,
      interval: billingInterval,
      prices: this.prices,
      ...(retentionDays === undefined ? {} : { retentionDays }),
    });

    const subscription = await this.createPendingSubscription({
      organizationId,
      membersToAdd,
      checkoutCurrency,
      billingInterval,
      ...(retentionDays === undefined ? {} : { retentionDays }),
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
      ...(successPath ? { successPath } : {}),
    });
    return { url, subscriptionId: subscription.id };
  };

  /** A paid checkout must not leave a second ACTIVE row beside one it does not replace. */
  private async refuseBesideLivePlan(organizationId: string): Promise<void> {
    const active = await this.subscriptions.findActivePlans({ organizationId });
    const customDeal = active.find((row) => row.stripeSubscriptionId === null && isCustomDeal(row));
    if (customDeal) {
      logger.warn(
        { organizationId, subscriptionId: customDeal.id },
        "[billing] Seat checkout refused: the live plan is a custom deal with no Stripe link",
      );
      throw new SeatChangeNeedsSupportError();
    }
    if (!blocksSeatCheckout(active)) return;

    logger.warn(
      { organizationId, subscriptionIds: active.map((s) => s.id) },
      "[billing] Seat checkout refused: a linked plan it would not replace is live",
    );
    throw new SubscriptionAlreadyActiveError();
  }

  /**
   * Cancels the PENDING subscriptions abandoned checkouts left behind, and the
   * PAYMENT_PENDING invites that hung off them.
   */
  private async cancelAbandonedCheckouts({
    organizationId,
    customerId,
  }: {
    organizationId: string;
    customerId: string;
  }): Promise<void> {
    const staleSubIds = await this.subscriptions.cancelPendingSeatCheckouts({ organizationId });
    if (staleSubIds.length === 0) return;
    await this.expireAbandonedSessions({ organizationId, customerId, staleSubIds });
    await this.abandoned.seatCheckoutsAbandoned({ organizationId, subscriptionIds: staleSubIds });
  }

  /**
   * Closes the Stripe sessions of the cancelled rows so a stale tab cannot pay for a second plan.
   * A failure is logged: checkout completion still refuses a second live plan.
   */
  private async expireAbandonedSessions({
    organizationId,
    customerId,
    staleSubIds,
  }: {
    organizationId: string;
    customerId: string;
    staleSubIds: string[];
  }): Promise<void> {
    try {
      const expired = await this.stripeSubscriptions.expireOpenCheckouts({
        customerId,
        clientReferenceIds: staleSubIds.map((id) => `subscription_setup_${id}`),
      });
      if (expired.length > 0) {
        logger.info({ organizationId, expired }, "[billing] Expired abandoned seat checkouts");
      }
    } catch (error) {
      logger.warn(
        { organizationId, staleSubIds, error },
        "[billing] Could not expire abandoned seat checkouts",
      );
    }
  }

  /** The pending subscription; organization holds a checkout's invites against its id (C2 A). */
  private async createPendingSubscription({
    organizationId,
    membersToAdd,
    checkoutCurrency,
    billingInterval,
    retentionDays,
  }: {
    organizationId: string;
    membersToAdd: number;
    checkoutCurrency: Currency;
    billingInterval: BillingInterval;
    retentionDays?: number;
  }): Promise<{ id: string }> {
    const subscription = await this.subscriptions.createPendingSeatCheckout({
      organizationId,
      plan: resolveGrowthSeatPlanType({ currency: checkoutCurrency, interval: billingInterval }),
      maxMembers: membersToAdd,
      ...(retentionDays === undefined ? {} : { maxRetentionDays: retentionDays }),
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
    const found = await this.findSeatSubscription(organizationId, { heal: true });
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
    const target = await this.loadSeatChangeTarget(organizationId, { heal: true });
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

  /** The quote for `added` seats beyond the ones billed now; refuses as previewProration does. */
  async quoteAddedSeats({
    organizationId,
    added,
  }: {
    organizationId: string;
    added: number;
  }): Promise<SeatEventProrationQuote> {
    const { subscription, seatItem } = await this.loadSeatChangeTarget(organizationId);
    const billed = seatItem.quantity ?? subscription.maxMembers ?? 0;
    return this.previewProration({ organizationId, newTotalSeats: billed + added });
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
      formattedSeatPrice: format(unitAmountCents),
      billingInterval,
      // The instant this quote priced, sent back on confirm so the charge matches it.
      quotedAt: prorationDate,
      appliesAt: plan.appliesAt?.epochMilliseconds ?? null,
      keptSeats: plan.kept?.seats ?? null,
      formattedKeptRecurringTotal: plan.kept ? format(plan.kept.seats * unitAmountCents) : null,
      renewsAt: stripeSubscription.currentPeriodEnd
        ? stripeSubscription.currentPeriodEnd * 1000
        : null,
    };
  };

  /**
   * The seats the organization's Stripe-backed plan bills, from its row: the most any ACTIVE
   * linked row holds, so an account billing cannot tell apart still counts from a real plan.
   * No Stripe call.
   */
  async billedSeats(organizationId: string): Promise<number> {
    const candidates = await this.subscriptions.findSeatCandidates({ organizationId });
    return candidates
      .filter((row) => row.status === SubscriptionStatus.ACTIVE && row.stripeSubscriptionId)
      .reduce((most, row) => Math.max(most, row.maxMembers ?? 0), 0);
  }

  /**
   * The live seat subscription, its provider record and seat line; refuses by name. Only a
   * change passes `heal`, which closes stray rows beside the live one; a read leaves them.
   */
  seatChangeTarget = (
    organizationId: string,
    options: { heal: boolean } = { heal: false },
  ): ReturnType<SeatEventSubscriptionService["loadSeatChangeTarget"]> =>
    this.loadSeatChangeTarget(organizationId, options);

  /** How `requested` seats reach the provider from what the target bills and keeps now. */
  seatChangePlan = ({
    target,
    requested,
  }: {
    target: Awaited<ReturnType<SeatEventSubscriptionService["seatChangeTarget"]>>;
    requested: number;
  }): SeatChangePlan => this.planChange({ target, requested });

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
