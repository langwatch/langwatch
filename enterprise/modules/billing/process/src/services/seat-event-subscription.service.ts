import {
  Currency,
  type Currency as CurrencyType,
  type BillingInterval,
  createCheckoutLineItems,
  resolveGrowthSeatPlanType,
  SeatChangeBusyError,
  SeatChangeNeedsSupportError,
  type StripePriceMap,
  SubscriptionItemNotFoundError,
  SubscriptionAlreadyActiveError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../repositories/seat-event-subscription.repository.ts";
import { blocksSeatCheckout, isCustomDeal } from "../rules/seat-checkout-guard.rules.ts";
import {
  chargedAmounts,
  type SeatEventProrationQuote,
  resolveProrationDate,
  seatChange,
} from "../rules/seat-event-quote.rules.ts";
import type { SeatChangePlan } from "../rules/seat-kept.rules.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import type { DuplicateSubscriptionAlerts } from "./duplicate-subscription-alert.service.ts";
import { type SeatChangeTarget, SeatChangeTargetService } from "./seat-change-target.service.ts";
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
  private readonly abandoned: Pick<
    BillingLifecycleAnnouncerService,
    "seatCheckoutsAbandoned" | "audited"
  >;
  private readonly prices: StripePriceMap;
  private readonly customerCurrency: StripeCustomerCurrencyService;
  private readonly seatLine: SeatLineMoveService;
  private readonly lease: SeatLineLeaseService;
  private readonly checkoutSessions: SeatCheckoutSessionService;
  private readonly targets: SeatChangeTargetService;

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
    this.targets = SeatChangeTargetService.create({
      stripeSubscriptions,
      subscriptions,
      audit: abandoned,
      prices,
      duplicates,
    });
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
    const found = await this.targets.getSubscription(organizationId, { heal: true });
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
    const target = await this.targets.load(organizationId, { heal: true });
    if (target.subscription.id !== leased) throw new SeatChangeBusyError();
    const { subscription, stripeSubscription, seatItem } = target;
    const plan = this.targets.plan({ target, requested: totalMembers });

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

  /** The quote for `added` seats beyond the ones billed now; refuses as previewProration does. */
  async quoteAddedSeats({
    organizationId,
    added,
  }: {
    organizationId: string;
    added: number;
  }): Promise<SeatEventProrationQuote> {
    const { subscription, seatItem } = await this.targets.load(organizationId);
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

    const target = await this.targets.load(organizationId);
    const { subscription, stripeSubscription, seatItem } = target;
    const plan = this.targets.plan({ target, requested: newTotalSeats });

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
  ): Promise<SeatChangeTarget> => this.targets.load(organizationId, options);

  /** How `requested` seats reach the provider from what the target bills and keeps now. */
  seatChangePlan = ({
    target,
    requested,
  }: {
    target: SeatChangeTarget;
    requested: number;
  }): SeatChangePlan => this.targets.plan({ target, requested });

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
