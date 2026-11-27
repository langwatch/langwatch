import {
  Currency,
  SubscriptionAlreadyActiveError,
  SubscriptionRecordNotFoundError,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a completed Stripe checkout does to our records: linking the subscription, persisting
 * the currency the buyer chose, approving the invites the payment was pending on, setting
 * the annual billing threshold, and giving the Billing role to whoever started it.
 */
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";

import type { BillingWebhookHost } from "../channels/billing-webhook-host.channel.ts";
import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { BillingWebhookOrganizationRepository } from "../repositories/billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscriptionRepository } from "../repositories/billing-webhook-subscription.repository.ts";
import { isCustomDeal } from "../rules/seat-checkout-guard.rules.ts";
import { AnnualEventsBillingThresholdService } from "./annual-events-billing-threshold.service.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";
import {
  BillingStarterRoleService,
  type CheckoutBillingRoles,
} from "./billing-starter-role.service.ts";
import {
  BillingSubscriptionLifecycleService,
  type LicenseClearer,
} from "./billing-subscription-lifecycle.service.ts";
import type { DuplicateSubscriptionAlerts } from "./duplicate-subscription-alert.service.ts";
import type { SubscriptionItemCalculatorService } from "./subscription-item-calculator.service.ts";
import { SupersededPlanRetirementError } from "./tiered-plan-retirement.service.ts";

const logger = createLogger("langwatch:billing:checkoutCompletion");

const VALID_CURRENCIES_FOR_CHECKOUT = new Set<string>(Object.values(Currency));
const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;
/** Who the audit names when a checkout is moved onto the row an operator added. */
const CHECKOUT_ADOPTION_ACTOR = "system:billing";

type BillingCheckoutCompletionOptions = {
  /** Absent where no authz is composed: the checkout then grants no role. */
  billingRoles?: CheckoutBillingRoles;
  subscriptionRepository: BillingWebhookSubscriptionRepository;
  organizationRepository: BillingWebhookOrganizationRepository;
  stripeSubscriptions: Pick<
    StripeSubscriptionsChannel,
    "getSubscription" | "updateSubscription" | "cancelSubscription" | "refundLatestInvoice"
  >;
  itemCalculator: Pick<SubscriptionItemCalculatorService, "calculateQuantityForPrice"> & {
    prices: StripePriceMap;
  };
  licenses: LicenseClearer;
  host: BillingWebhookHost;
  /** Records the checkout and subscription changes for peers; absent where none is composed. */
  announcer?: Pick<
    BillingLifecycleAnnouncerService,
    | "checkoutCompleted"
    | "subscriptionActivated"
    | "subscriptionCancelled"
    | "checkoutCurrencySelected"
    | "seatCheckoutPaid"
    | "pricingModelChanged"
    | "audited"
    | "seatCheckoutsAbandoned"
  >;
  /** Ops hear about a second paid seat checkout; absent, nobody does. */
  duplicates?: DuplicateSubscriptionAlerts;
};

export class BillingCheckoutCompletionService {
  static create(options: BillingCheckoutCompletionOptions): BillingCheckoutCompletionService {
    return new BillingCheckoutCompletionService(options);
  }

  private readonly subscriptionRepository: BillingWebhookSubscriptionRepository;
  private readonly organizationRepository: BillingWebhookOrganizationRepository;
  private readonly host: BillingWebhookHost;
  private readonly announcer: BillingCheckoutCompletionOptions["announcer"];
  private readonly starterRole: BillingStarterRoleService | undefined;
  private readonly annualThreshold: AnnualEventsBillingThresholdService;
  private readonly lifecycle: BillingSubscriptionLifecycleService;
  private readonly stripeSubscriptions: BillingCheckoutCompletionOptions["stripeSubscriptions"];
  private readonly duplicates: DuplicateSubscriptionAlerts | undefined;

  private constructor(options: BillingCheckoutCompletionOptions) {
    this.subscriptionRepository = options.subscriptionRepository;
    this.stripeSubscriptions = options.stripeSubscriptions;
    this.duplicates = options.duplicates;
    this.organizationRepository = options.organizationRepository;
    this.host = options.host;
    this.announcer = options.announcer;
    this.starterRole = options.billingRoles
      ? BillingStarterRoleService.create({ billingRoles: options.billingRoles })
      : undefined;
    this.annualThreshold = AnnualEventsBillingThresholdService.create({
      subscriptions: options.stripeSubscriptions,
      prices: options.itemCalculator.prices,
    });
    this.lifecycle = BillingSubscriptionLifecycleService.create({
      subscriptionRepository: options.subscriptionRepository,
      organizationRepository: options.organizationRepository,
      licenses: options.licenses,
      stripeSubscriptions: options.stripeSubscriptions,
      itemCalculator: options.itemCalculator,
      host: options.host,
      ...(options.announcer ? { announcer: options.announcer } : {}),
    });
  }

  async dispatchCheckoutCompleted({
    event,
    subscriptionId,
    customerId,
    organizationId,
  }: {
    event: Stripe.Event & { type: "checkout.session.completed" };
    subscriptionId: string;
    customerId?: string;
    organizationId: string | null;
  }): Promise<void> {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    const selectedCurrencyRaw = checkoutSession.metadata?.selectedCurrency;
    const selectedCurrency =
      selectedCurrencyRaw && VALID_CURRENCIES_FOR_CHECKOUT.has(selectedCurrencyRaw)
        ? selectedCurrencyRaw
        : null;

    const result = await this.handleCheckoutCompleted({
      subscriptionId,
      clientReferenceId: checkoutSession.client_reference_id ?? null,
      selectedCurrency,
    });

    if (result.duplicate) return;

    if (result.earlyReturn) {
      logger.error(
        {
          eventId: event.id,
          customerId: customerId ? maskCustomerId(customerId) : null,
        },
        "[stripeWebhook] No client_reference_id in checkout session",
      );

      return;
    }

    if (organizationId) {
      await this.starterRole?.grantToStarter({
        organizationId,
        startedByUserId: checkoutSession.metadata?.startedByUserId ?? null,
        eventId: event.id,
      });
      await this.announcer?.checkoutCompleted({
        organizationId,
        subscriptionId,
        checkoutCreatedAt: Temporal.Instant.fromEpochMilliseconds(
          checkoutSession.created * 1000,
        ).toString(),
      });
    }
  }

  /** An expired seat checkout ends its PENDING row and tells peers the checkout was abandoned. */
  async dispatchCheckoutExpired({
    event,
  }: {
    event: Stripe.Event & { type: "checkout.session.expired" };
  }): Promise<void> {
    const reference = (event.data.object as Stripe.Checkout.Session).client_reference_id;
    if (!reference?.startsWith("subscription_setup_")) return;
    const id = reference.slice("subscription_setup_".length);
    const cancelled = await this.subscriptionRepository.cancelPendingCheckout({ id });
    for (const { organizationId } of cancelled) {
      logger.info({ organizationId, subscriptionId: id }, "[stripeWebhook] Seat checkout expired");
      await this.announcer?.seatCheckoutsAbandoned({ organizationId, subscriptionIds: [id] });
    }
  }

  async handleCheckoutCompleted({
    subscriptionId,
    clientReferenceId,
    selectedCurrency,
  }: {
    subscriptionId: string;
    clientReferenceId: string | null;
    selectedCurrency?: string | null;
  }): Promise<{ earlyReturn: boolean; duplicate?: boolean }> {
    const subscriptionClientReferenceId = clientReferenceId?.replace("subscription_setup_", "");

    if (!subscriptionClientReferenceId) {
      return { earlyReturn: true };
    }

    // A redelivery finds the row this checkout already landed on and links nothing new.
    const alreadyLinked = await this.subscriptionRepository.findByStripeId(subscriptionId);
    // A checkout refused as a second plan, or a plan since ended, starts nothing again.
    if (alreadyLinked?.status === SubscriptionStatus.CANCELLED) {
      return { earlyReturn: false, duplicate: true };
    }
    if (
      !alreadyLinked &&
      (await this.refuseSecondPlan({
        pendingId: subscriptionClientReferenceId,
        stripeSubscriptionId: subscriptionId,
      }))
    ) {
      return { earlyReturn: false, duplicate: true };
    }
    let failures: unknown[];
    try {
      failures = await this.landPaidPlan({
        pendingId: subscriptionClientReferenceId,
        subscriptionId,
        alreadyLinkedId: alreadyLinked?.id ?? null,
      });
    } catch (error) {
      // Another checkout took the live plan, or linked the operator's row, after the check above.
      if (!(error instanceof SubscriptionAlreadyActiveError)) throw error;
      const refused = await this.refuseSecondPlan({
        pendingId: subscriptionClientReferenceId,
        stripeSubscriptionId: subscriptionId,
      });
      if (!refused) throw error;
      return { earlyReturn: false, duplicate: true };
    }

    const subscriptionRecord = await this.subscriptionRepository.findByStripeId(subscriptionId);

    failures.push(
      ...(await this.announcePaidCheckout({
        subscriptionId,
        pendingId: subscriptionClientReferenceId,
        organizationId: subscriptionRecord?.organizationId ?? null,
        selectedCurrency,
      })),
    );

    // Cancel any active trial subscriptions for this org
    if (subscriptionRecord) {
      await this.subscriptionRepository.cancelTrialSubscriptions(subscriptionRecord.organizationId);
    }

    await this.trySetAnnualEventsBillingThreshold(subscriptionId);

    if (failures.length > 0) throw failures[0];

    return { earlyReturn: false };
  }

  /** Links the paid subscription to its row and starts the plan; follow-up failures returned. */
  private async landPaidPlan({
    pendingId,
    subscriptionId,
    alreadyLinkedId,
  }: {
    pendingId: string;
    subscriptionId: string;
    alreadyLinkedId: string | null;
  }): Promise<unknown[]> {
    const linkedId =
      alreadyLinkedId ??
      (await this.landOnLivePlan({ pendingId, stripeSubscriptionId: subscriptionId }));
    const updateResult = await this.subscriptionRepository.linkStripeId({
      id: linkedId,
      stripeSubscriptionId: subscriptionId,
    });
    if (updateResult.count === 0) {
      logger.error(
        { subscriptionClientReferenceId: pendingId },
        "[stripeWebhook] No subscription found for checkout",
      );
      throw new SubscriptionRecordNotFoundError(pendingId);
    }
    // A failed follow-up still lets the plan land, then fails the delivery so
    // Stripe redelivers it: every step here is safe to repeat.
    return this.syncPaidPlan({ subscriptionId, startsPlan: alreadyLinkedId === null });
  }

  /** Lands the paid plan; a refused old-plan retirement is returned so the delivery fails later. */
  private async syncPaidPlan({
    subscriptionId,
    startsPlan,
  }: {
    subscriptionId: string;
    startsPlan: boolean;
  }): Promise<unknown[]> {
    try {
      await this.lifecycle.syncInvoicePaymentSuccess({
        subscriptionId,
        throwOnMissing: true,
        startsPlan,
      });
      return [];
    } catch (err) {
      if (!(err instanceof SupersededPlanRetirementError)) throw err;
      return [err];
    }
  }

  /** The currency choice and the held invites a paid checkout announces; failures returned. */
  private async announcePaidCheckout({
    subscriptionId,
    pendingId,
    organizationId,
    selectedCurrency,
  }: {
    subscriptionId: string;
    pendingId: string;
    organizationId: string | null;
    selectedCurrency?: string | null;
  }): Promise<unknown[]> {
    const failures: unknown[] = [];
    const normalizedCurrency = this.normalizeSelectedCurrency(selectedCurrency);
    if (normalizedCurrency && organizationId !== null) {
      try {
        await this.announcer?.checkoutCurrencySelected({
          organizationId,
          currency: normalizedCurrency,
        });
      } catch (err) {
        logger.error(
          { subscriptionId, selectedCurrency: normalizedCurrency, err },
          "[stripeWebhook] Failed to persist selected currency on checkout completion; the delivery will be retried",
        );
        failures.push(err);
      }
    }

    // Organization opens the PAYMENT_PENDING invites linked to this subscription from the fact.
    if (this.announcer && organizationId !== null) {
      try {
        // The invitations were held against the checkout's own row, even when it was adopted.
        await this.announcer.seatCheckoutPaid({
          subscriptionId: pendingId,
          organizationId,
        });
      } catch (err) {
        logger.error(
          { subscriptionId, err },
          "[stripeWebhook] Failed to approve PAYMENT_PENDING invites after checkout; the delivery will be retried",
        );
        failures.push(err);
      }
    }
    return failures;
  }

  /**
   * The row a paid checkout links to. An ACTIVE row with no provider link (one an operator made
   * or activated in Ops) is the organization's live plan: the checkout lands on it, so the
   * organization keeps one active subscription. Several such rows are left to ops.
   */
  private async landOnLivePlan({
    pendingId,
    stripeSubscriptionId,
  }: {
    pendingId: string;
    stripeSubscriptionId: string;
  }): Promise<string> {
    const live = await this.subscriptionRepository.findLiveUnlinkedBeside({ pendingId });
    const [only] = live;
    if (only && isCustomDeal(only)) {
      logger.error(
        { organizationId: only.organizationId, pendingId, liveId: only.id },
        "[stripeWebhook] Checkout completed beside a custom plan; it is not moved onto it, ops must settle it",
      );
      return pendingId;
    }
    if (only && live.length === 1) {
      // Audited before the write: a refused audit fails the delivery and Stripe redelivers it.
      await this.announcer?.audited({
        tenantId: only.organizationId,
        userId: CHECKOUT_ADOPTION_ACTOR,
        action: "subscription.adoptCheckout",
        args: { pendingId, liveId: only.id },
        targetKind: "organization",
        targetId: only.organizationId,
      });
      await this.subscriptionRepository.adoptCheckout({
        pendingId,
        liveId: only.id,
        stripeSubscriptionId,
      });
      logger.warn(
        { organizationId: only.organizationId, pendingId, liveId: only.id },
        "[stripeWebhook] Checkout landed on the organization's live unlinked subscription",
      );
      return only.id;
    }
    if (live.length > 1) {
      logger.error(
        { pendingId, liveIds: live.map((row) => row.id) },
        "[stripeWebhook] Checkout completed beside several unlinked active subscriptions; ops must keep one",
      );
    }
    return pendingId;
  }

  /**
   * A checkout paid while the organization already holds a linked seat plan (a stale tab, two
   * admins at once) would start a second plan. Its subscription is cancelled and its payment
   * given back, its row is kept cancelled with the link, and ops are told.
   */
  private async refuseSecondPlan({
    pendingId,
    stripeSubscriptionId,
  }: {
    pendingId: string;
    stripeSubscriptionId: string;
  }): Promise<boolean> {
    const live = await this.subscriptionRepository.findLiveLinkedBeside({ pendingId });
    const [kept] = live;
    if (!kept) return false;
    const { organizationId } = kept;
    logger.error(
      { organizationId, pendingId, keptId: kept.id, stripeSubscriptionId },
      "[stripeWebhook] Second seat checkout paid beside a live plan; cancelling and refunding it",
    );
    await this.announcer?.audited({
      tenantId: organizationId,
      userId: CHECKOUT_ADOPTION_ACTOR,
      action: "subscription.refuseSecondCheckout",
      args: { pendingId, keptId: kept.id, stripeSubscriptionId },
      targetKind: "organization",
      targetId: organizationId,
    });
    const current = await this.stripeSubscriptions.getSubscription({
      subscriptionId: stripeSubscriptionId,
    });
    if (current.status !== "canceled") {
      await this.stripeSubscriptions.cancelSubscription({
        subscriptionId: stripeSubscriptionId,
        prorate: false,
      });
    }
    await this.giveBackPayment({ organizationId, stripeSubscriptionId });
    await this.subscriptionRepository.linkStripeId({ id: pendingId, stripeSubscriptionId });
    await this.subscriptionRepository.cancel({ id: pendingId });
    await this.announcer?.seatCheckoutsAbandoned({ organizationId, subscriptionIds: [pendingId] });
    await this.duplicates?.reportDuplicateActive({
      organizationId,
      subscriptionIds: [...live.map((row) => row.id), pendingId],
    });
    return true;
  }

  /** A refused give-back is left to ops, who the duplicate alert already names it to. */
  private async giveBackPayment({
    organizationId,
    stripeSubscriptionId,
  }: {
    organizationId: string;
    stripeSubscriptionId: string;
  }): Promise<void> {
    try {
      const outcome = await this.stripeSubscriptions.refundLatestInvoice({
        subscriptionId: stripeSubscriptionId,
      });
      logger.warn(
        { organizationId, stripeSubscriptionId, outcome },
        "[stripeWebhook] Second checkout's payment given back",
      );
    } catch (err) {
      logger.error(
        { organizationId, stripeSubscriptionId, err },
        "[stripeWebhook] CRITICAL: could not refund a second seat checkout; refund it in Stripe",
      );
    }
  }

  /**
   * The billing threshold makes Stripe collect annual overage in slices, not
   * one oversized invoice. Best-effort — we answer Stripe 200 regardless, so
   * a failure raises a (also best-effort) Slack alert instead.
   */
  private async trySetAnnualEventsBillingThreshold(subscriptionId: string): Promise<void> {
    try {
      const thresholdResult = await this.annualThreshold.apply({
        stripeSubscriptionId: subscriptionId,
      });
      logger.info(
        { subscriptionId, thresholdResult },
        "[stripeWebhook] Annual events billing threshold evaluated",
      );
    } catch (err) {
      logger.error(
        { subscriptionId, err },
        "[stripeWebhook] Failed to set annual events billing threshold — re-run the backfill script or apply manually",
      );
      try {
        await this.host.sendSlackBillingThresholdFailureAlert({
          stripeSubscriptionId: subscriptionId,
          reason: err instanceof Error ? err.message : String(err),
        });
      } catch (alertErr) {
        logger.error(
          { subscriptionId, err: alertErr },
          "[stripeWebhook] Failed to alert on billing-threshold failure",
        );
      }
    }
  }

  private normalizeSelectedCurrency(value?: string | null): Currency | null {
    if (value === Currency.EUR || value === Currency.USD) {
      return value;
    }

    return null;
  }
}
