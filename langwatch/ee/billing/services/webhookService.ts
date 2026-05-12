import { Currency, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import type { PostHog } from "posthog-node";
import { createLogger } from "../../../src/utils/logger";
import { getApp } from "../../../src/server/app-layer/app";
import type {
  SubscriptionRepository,
  SubscriptionWithOrg,
} from "../../../src/server/app-layer/subscription/subscription.repository";
import type { OrganizationRepository } from "../../../src/server/app-layer/organizations/repositories/organization.repository";
import { PrismaOrganizationRepository } from "../../../src/server/app-layer/organizations/repositories/organization.prisma.repository";
import { PrismaSubscriptionRepository } from "./subscription.repository";
import { SubscriptionStatus } from "../planTypes";
import type { calculateQuantityForPrice, prices } from "./subscriptionItemCalculator";
import { isGrowthEventsPrice, isGrowthSeatEventPlan, isGrowthSeatPrice } from "../utils/growthSeatEvent";
import { SubscriptionRecordNotFoundError } from "../errors";
import { traced } from "../../../src/server/app-layer/tracing";
import { fireSubscriptionSyncNurturing } from "../nurturing/hooks/subscriptionSync";

const logger = createLogger("langwatch:billing:webhookService");

const VALID_CURRENCIES_FOR_CHECKOUT = new Set<string>(Object.values(Currency));
const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

type ItemCalculator = {
  calculateQuantityForPrice: typeof calculateQuantityForPrice;
  prices: typeof prices;
};

type InviteApprover = {
  approvePaymentPendingInvites(params: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<unknown>;
};

/**
 * License purchase events originate from a specific Stripe payment link and
 * target self-hosted buyers who have no organization in the SaaS database.
 * The webhook service routes these before any org lookup.
 */
export interface LicensePurchaseHandler {
  handle(params: {
    checkoutSession: Stripe.Checkout.Session;
    stripe: Stripe;
    privateKey: string;
  }): Promise<void>;
}

export type HandleEventResult =
  | { status: "ok" }
  | { status: "error"; httpStatus: 400 | 500; message: string };

/** Stripe webhooks can arrive before subscription state is fully consistent. */
const STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS = 2000;
// TECH-DEBT: This fixed delay should become a retry loop with backoff.
const waitForStripeConsistency = () =>
  new Promise((resolve) => setTimeout(resolve, STRIPE_EVENTUAL_CONSISTENCY_DELAY_MS));

export type WebhookService = {
  /**
   * Dispatches a verified Stripe event to the right handler.
   *
   * Signature verification happens at the transport layer (the Hono route);
   * this method is transport-agnostic so it can be reused from workers,
   * replays, and tests.
   *
   * Retry policy:
   * - Returns `{ status: "ok" }` for no-op events (unknown types, events we
   *   do not care about). Stripe will mark delivery successful — no retry.
   * - Returns `{ status: "error", httpStatus: 500 }` on unexpected throws.
   *   Stripe retries with backoff — correct for transient infra failures
   *   and for bugs that will succeed after a deploy.
   * - Every non-action branch logs at INFO/ERROR — nothing returns silently.
   */
  handleEvent(event: Stripe.Event): Promise<HandleEventResult>;

  handleCheckoutCompleted(params: {
    subscriptionId: string;
    clientReferenceId: string | null;
    selectedCurrency?: string | null;
  }): Promise<{ earlyReturn: boolean }>;

  handleInvoicePaymentSucceeded(params: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }): Promise<void>;

  handleInvoicePaymentFailed(params: {
    subscriptionId: string;
  }): Promise<void>;

  handleSubscriptionDeleted(params: {
    stripeSubscriptionId: string;
  }): Promise<void>;

  handleSubscriptionUpdated(params: {
    subscription: Stripe.Subscription;
  }): Promise<void>;
};

export class EEWebhookService implements WebhookService {
  private readonly subscriptionRepository: SubscriptionRepository;
  private readonly organizationRepository: OrganizationRepository;
  private readonly stripe: Stripe;
  private readonly itemCalculator: ItemCalculator;
  private readonly inviteApprover?: InviteApprover;
  private readonly licensePurchaseHandler?: LicensePurchaseHandler;
  private readonly licensePaymentLinkId?: string;
  private readonly licensePrivateKey?: string;
  private readonly getPostHog?: () => PostHog | null;

  constructor({
    subscriptionRepository,
    organizationRepository,
    stripe,
    itemCalculator,
    inviteApprover,
    licensePurchaseHandler,
    licensePaymentLinkId,
    licensePrivateKey,
    getPostHog,
  }: {
    subscriptionRepository: SubscriptionRepository;
    organizationRepository: OrganizationRepository;
    stripe: Stripe;
    itemCalculator: ItemCalculator;
    inviteApprover?: InviteApprover;
    licensePurchaseHandler?: LicensePurchaseHandler;
    licensePaymentLinkId?: string;
    licensePrivateKey?: string;
    getPostHog?: () => PostHog | null;
  }) {
    this.subscriptionRepository = subscriptionRepository;
    this.organizationRepository = organizationRepository;
    this.stripe = stripe;
    this.itemCalculator = itemCalculator;
    this.inviteApprover = inviteApprover;
    this.licensePurchaseHandler = licensePurchaseHandler;
    this.licensePaymentLinkId = licensePaymentLinkId;
    this.licensePrivateKey = licensePrivateKey;
    this.getPostHog = getPostHog;
  }

  static create({
    db,
    stripe,
    itemCalculator,
    inviteApprover,
    licensePurchaseHandler,
    licensePaymentLinkId,
    licensePrivateKey,
    getPostHog,
  }: {
    db: PrismaClient;
    stripe: Stripe;
    itemCalculator: ItemCalculator;
    inviteApprover?: InviteApprover;
    licensePurchaseHandler?: LicensePurchaseHandler;
    licensePaymentLinkId?: string;
    licensePrivateKey?: string;
    getPostHog?: () => PostHog | null;
  }): WebhookService {
    return traced(
      new EEWebhookService({
        subscriptionRepository: new PrismaSubscriptionRepository(db),
        organizationRepository: new PrismaOrganizationRepository(db),
        stripe,
        itemCalculator,
        inviteApprover,
        licensePurchaseHandler,
        licensePaymentLinkId,
        licensePrivateKey,
        getPostHog,
      }),
      "EEWebhookService",
    );
  }

  async handleEvent(event: Stripe.Event): Promise<HandleEventResult> {
    try {
      if (event.type === "checkout.session.completed") {
        const licenseResult = await this.tryRouteLicensePurchase(event);
        if (licenseResult) return licenseResult;
      }

      if (
        event.type === "checkout.session.completed" ||
        event.type === "invoice.payment_succeeded" ||
        event.type === "invoice.payment_failed"
      ) {
        return await this.routeCheckoutOrInvoice(event);
      }

      if (
        event.type === "customer.subscription.deleted" ||
        event.type === "customer.subscription.updated"
      ) {
        return await this.routeSubscriptionLifecycle(event);
      }

      logger.info(
        { eventType: event.type, eventId: event.id },
        "[stripeWebhook] Ignoring unhandled event type",
      );
      return { status: "ok" };
    } catch (error) {
      logger.error(
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          eventType: event.type,
          eventId: event.id,
        },
        "[stripeWebhook] Unhandled error processing event",
      );
      return {
        status: "error",
        httpStatus: 500,
        message: "Webhook processing error",
      };
    }
  }

  /**
   * Returns a result when the session is a license purchase, otherwise null
   * so `handleEvent` falls through to the subscription flow.
   */
  private async tryRouteLicensePurchase(
    event: Stripe.Event & { type: "checkout.session.completed" },
  ): Promise<HandleEventResult | null> {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;

    const paymentLinkId =
      typeof checkoutSession.payment_link === "string"
        ? checkoutSession.payment_link
        : checkoutSession.payment_link?.id;

    if (
      !this.licensePaymentLinkId ||
      paymentLinkId !== this.licensePaymentLinkId
    ) {
      return null;
    }

    if (!this.licensePurchaseHandler) {
      logger.error(
        { eventId: event.id },
        "[stripeWebhook] License purchase handler is not configured",
      );
      return {
        status: "error",
        httpStatus: 500,
        message: "License generation error: handler not configured",
      };
    }

    if (!this.licensePrivateKey) {
      logger.error(
        { eventId: event.id },
        "[stripeWebhook] LANGWATCH_LICENSE_PRIVATE_KEY is not configured",
      );
      return {
        status: "error",
        httpStatus: 500,
        message: "License generation error: missing private key",
      };
    }

    await this.licensePurchaseHandler.handle({
      checkoutSession,
      stripe: this.stripe,
      privateKey: this.licensePrivateKey,
    });

    return { status: "ok" };
  }

  private async routeCheckoutOrInvoice(
    event: Stripe.Event & {
      type:
        | "checkout.session.completed"
        | "invoice.payment_succeeded"
        | "invoice.payment_failed";
    },
  ): Promise<HandleEventResult> {
    const paymentIntent = event.data.object as
      | Stripe.Checkout.Session
      | Stripe.Invoice;

    const subscriptionId =
      typeof paymentIntent.subscription === "string"
        ? paymentIntent.subscription
        : paymentIntent.subscription?.id;

    if (!subscriptionId) {
      logger.info(
        { eventType: event.type, eventId: event.id },
        "[stripeWebhook] Event has no subscription id — skipping",
      );
      return { status: "ok" };
    }

    // Customer/organization lookup is best-effort for analytics only.
    // Core handlers only need subscriptionId (+ client_reference_id for
    // checkout) — dropping the work here would ACK the event to Stripe
    // (no retry) while leaving the DB subscription PENDING.
    const customerId =
      typeof paymentIntent.customer === "string"
        ? paymentIntent.customer
        : paymentIntent.customer?.id;

    const organization = customerId
      ? await this.organizationRepository.findByStripeCustomerId(customerId)
      : null;

    if (customerId && !organization) {
      logger.warn(
        {
          eventType: event.type,
          eventId: event.id,
          customerId: maskCustomerId(customerId),
        },
        "[stripeWebhook] No organization found for customer — proceeding without analytics",
      );
    }

    switch (event.type) {
      case "checkout.session.completed":
        await this.dispatchCheckoutCompleted({
          event: event as Stripe.Event & { type: "checkout.session.completed" },
          subscriptionId,
          customerId,
          organizationId: organization?.id ?? null,
        });
        return { status: "ok" };

      case "invoice.payment_succeeded":
        await this.handleInvoicePaymentSucceeded({ subscriptionId });
        return { status: "ok" };

      case "invoice.payment_failed":
        await this.handleInvoicePaymentFailed({ subscriptionId });
        return { status: "ok" };
    }
  }

  private async dispatchCheckoutCompleted({
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
      selectedCurrencyRaw &&
      VALID_CURRENCIES_FOR_CHECKOUT.has(selectedCurrencyRaw)
        ? selectedCurrencyRaw
        : null;

    const result = await this.handleCheckoutCompleted({
      subscriptionId,
      clientReferenceId: checkoutSession.client_reference_id ?? null,
      selectedCurrency,
    });

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
      this.emitCheckoutAnalytics({
        checkoutSession,
        subscriptionId,
        organizationId,
      });
    }
  }

  private emitCheckoutAnalytics({
    checkoutSession,
    subscriptionId,
    organizationId,
  }: {
    checkoutSession: Stripe.Checkout.Session;
    subscriptionId: string;
    organizationId: string;
  }): void {
    const posthog = this.getPostHog?.() ?? null;
    if (!posthog) return;

    posthog.capture({
      distinctId: organizationId,
      event: "subscription_created",
      properties: {
        subscriptionId,
        $groups: { organization: organizationId },
      },
    });
    posthog.groupIdentify({
      groupType: "organization",
      groupKey: organizationId,
      properties: {
        subscriptionCreatedAt: new Date(
          checkoutSession.created * 1000,
        ).toISOString(),
        hasActiveSubscription: true,
      },
    });
  }

  private async routeSubscriptionLifecycle(
    event: Stripe.Event & {
      type: "customer.subscription.deleted" | "customer.subscription.updated";
    },
  ): Promise<HandleEventResult> {
    const subscription = event.data.object as Stripe.Subscription;
    if (!subscription.id) {
      logger.info(
        { eventType: event.type, eventId: event.id },
        "[stripeWebhook] Subscription event has no id — skipping",
      );
      return { status: "ok" };
    }

    if (event.type === "customer.subscription.deleted") {
      await this.handleSubscriptionDeleted({
        stripeSubscriptionId: subscription.id,
      });
    } else {
      await this.handleSubscriptionUpdated({ subscription });
    }

    return { status: "ok" };
  }

  async handleCheckoutCompleted({
    subscriptionId,
    clientReferenceId,
    selectedCurrency,
  }: {
    subscriptionId: string;
    clientReferenceId: string | null;
    selectedCurrency?: string | null;
  }): Promise<{ earlyReturn: boolean }> {
    const subscriptionClientReferenceId = clientReferenceId?.replace(
      "subscription_setup_",
      "",
    );

    if (!subscriptionClientReferenceId) {
      return { earlyReturn: true };
    }

    const updateResult = await this.subscriptionRepository.linkStripeId({
      id: subscriptionClientReferenceId,
      stripeSubscriptionId: subscriptionId,
    });

    if (updateResult.count === 0) {
      logger.error(
        { subscriptionClientReferenceId },
        "[stripeWebhook] No subscription found for checkout",
      );
      throw new SubscriptionRecordNotFoundError(
        subscriptionClientReferenceId,
      );
    }

    await this.syncInvoicePaymentSuccess({
      subscriptionId,
      throwOnMissing: true,
    });

    const subscriptionRecord = await this.subscriptionRepository.findByStripeId(subscriptionId);

    const normalizedCurrency = this.normalizeSelectedCurrency(selectedCurrency);
    if (normalizedCurrency && subscriptionRecord) {
      try {
        await this.organizationRepository.updateCurrency({
          organizationId: subscriptionRecord.organizationId,
          currency: normalizedCurrency,
        });
      } catch (err) {
        logger.warn(
          { subscriptionId, selectedCurrency: normalizedCurrency, err },
          "[stripeWebhook] Failed to persist selected currency on checkout completion",
        );
      }
    }

    // Approve PAYMENT_PENDING invites linked to this subscription
    if (this.inviteApprover && subscriptionRecord) {
      try {
        await this.inviteApprover.approvePaymentPendingInvites({
          subscriptionId: subscriptionRecord.id,
          organizationId: subscriptionRecord.organizationId,
        });
      } catch (err) {
        logger.error(
          { subscriptionId, err },
          "[stripeWebhook] Failed to approve PAYMENT_PENDING invites after checkout, manual resolution may be needed",
        );
      }
    }

    // Cancel any active trial subscriptions for this org
    if (subscriptionRecord) {
      await this.subscriptionRepository.cancelTrialSubscriptions(
        subscriptionRecord.organizationId,
      );
    }

    return { earlyReturn: false };
  }

  async handleInvoicePaymentSucceeded({
    subscriptionId,
    throwOnMissing,
  }: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }): Promise<void> {
    await this.syncInvoicePaymentSuccess({ subscriptionId, throwOnMissing });
  }

  async handleInvoicePaymentFailed({
    subscriptionId,
  }: {
    subscriptionId: string;
  }): Promise<void> {
    await waitForStripeConsistency();

    const currentSubscription =
      await this.subscriptionRepository.findByStripeId(subscriptionId);

    if (!currentSubscription) {
      logger.warn(
        { subscriptionId },
        "[stripeWebhook] No subscription record for payment failure, skipping",
      );
      return;
    }

    await this.subscriptionRepository.recordPaymentFailure({
      id: currentSubscription.id,
      currentStatus: currentSubscription.status,
    });
  }

  async handleSubscriptionDeleted({
    stripeSubscriptionId,
  }: {
    stripeSubscriptionId: string;
  }): Promise<void> {
    await waitForStripeConsistency();

    const existingSubscription =
      await this.subscriptionRepository.findByStripeId(stripeSubscriptionId);

    if (!existingSubscription) {
      logger.warn(
        { stripeSubscriptionId },
        "[stripeWebhook] No subscription for deletion event, skipping",
      );
      return;
    }

    // Idempotency: if already CANCELLED (e.g., by upgrade flow), skip redundant update
    if (existingSubscription.status === SubscriptionStatus.CANCELLED) {
      logger.info(
        { stripeSubscriptionId },
        "[stripeWebhook] Subscription already cancelled, skipping redundant update",
      );
      return;
    }

    await this.subscriptionRepository.cancel({ id: existingSubscription.id });

    // Send "Subscription cancelled" Slack notification
    try {
      const org = await this.organizationRepository.findNameById(
        existingSubscription.organizationId,
      );
      await getApp().notifications.sendSlackSubscriptionEvent({
        type: "cancelled",
        organizationId: existingSubscription.organizationId,
        organizationName: org?.name ?? "Unknown",
        plan: existingSubscription.plan,
        subscriptionId: existingSubscription.id,
        cancellationDate: new Date(),
      });
    } catch (err) {
      logger.error(
        { stripeSubscriptionId, err },
        "[stripeWebhook] Failed to send cancellation notification",
      );
    }

    const remainingActive = await this.subscriptionRepository.findLastNonCancelled(
      existingSubscription.organizationId,
    );
    fireSubscriptionSyncNurturing({
      organizationId: existingSubscription.organizationId,
      hasSubscription: !!remainingActive,
    });
  }

  async handleSubscriptionUpdated({
    subscription,
  }: {
    subscription: Stripe.Subscription;
  }): Promise<void> {
    await waitForStripeConsistency();

    const existingSubForUpdate =
      await this.subscriptionRepository.findByStripeId(subscription.id);

    if (!existingSubForUpdate) {
      logger.warn(
        { stripeSubscriptionId: subscription.id },
        "[stripeWebhook] No subscription for update event, skipping",
      );
      return;
    }

    if (
      subscription.status !== "active" ||
      subscription.ended_at
    ) {
      // Truly cancelled or ended — mark as CANCELLED in DB.
      // Note: canceled_at alone means "scheduled for cancellation at period end"
      // — the sub is still active until then, so we don't cancel in DB yet.
      // When the period ends, Stripe fires `customer.subscription.deleted`
      // which is handled by handleSubscriptionDeleted.
      await this.subscriptionRepository.cancel({ id: existingSubForUpdate.id });

      const remainingActive = await this.subscriptionRepository.findLastNonCancelled(
        existingSubForUpdate.organizationId,
      );
      fireSubscriptionSyncNurturing({
        organizationId: existingSubForUpdate.organizationId,
        hasSubscription: !!remainingActive,
      });
    } else if (subscription.status === "active") {
      const shouldNotify =
        existingSubForUpdate.status !== SubscriptionStatus.ACTIVE;

      let tracesQuantity: number | null = null;
      let usersQuantity: number | null = null;

      for (const item of subscription.items.data) {
        if (isGrowthSeatPrice(item.price.id)) {
          usersQuantity = item.quantity ?? 0;
        } else if (isGrowthEventsPrice(item.price.id)) {
          // Events price exists on the subscription; traces limit comes from plan limits
        } else if (
          item.price.id === this.itemCalculator.prices.LAUNCH_USERS ||
          item.price.id === this.itemCalculator.prices.ACCELERATE_USERS ||
          item.price.id === this.itemCalculator.prices.LAUNCH_ANNUAL_USERS ||
          item.price.id ===
            this.itemCalculator.prices.ACCELERATE_ANNUAL_USERS
        ) {
          const calculateQuantity =
            this.itemCalculator.calculateQuantityForPrice({
              priceId: item.price.id,
              quantity: item.quantity ?? 0,
              plan: existingSubForUpdate.plan,
            });
          usersQuantity = calculateQuantity;
        } else if (
          item.price.id ===
            this.itemCalculator.prices.ACCELERATE_TRACES_100K ||
          item.price.id === this.itemCalculator.prices.LAUNCH_TRACES_10K ||
          item.price.id ===
            this.itemCalculator.prices.LAUNCH_ANNUAL_TRACES_10K ||
          item.price.id ===
            this.itemCalculator.prices.ACCELERATE_ANNUAL_TRACES_100K
        ) {
          const calculateQuantity =
            this.itemCalculator.calculateQuantityForPrice({
              priceId: item.price.id,
              quantity: item.quantity ?? 0,
              plan: existingSubForUpdate.plan,
            });
          tracesQuantity = calculateQuantity;
        }
      }

      const updatedSubscription = await this.subscriptionRepository.updateQuantities({
        id: existingSubForUpdate.id,
        maxMembers: usersQuantity,
        maxMessagesPerMonth: tracesQuantity,
      });

      if (!updatedSubscription) {
        return;
      }

      await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription updated to active");

      if (shouldNotify) {
        await getApp().notifications.sendSlackSubscriptionEvent({
          type: "confirmed",
          organizationId: updatedSubscription.organizationId,
          organizationName: updatedSubscription.organization.name,
          plan: updatedSubscription.plan,
          subscriptionId: updatedSubscription.id,
          startDate: updatedSubscription.startDate,
          maxMembers: updatedSubscription.maxMembers,
          maxMessagesPerMonth: updatedSubscription.maxMessagesPerMonth,
        });
      }
    }
  }

  // --- Private helpers ---

  private async syncInvoicePaymentSuccess({
    subscriptionId,
    throwOnMissing = false,
  }: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }) {
    await waitForStripeConsistency();

    const previousSubscription =
      await this.subscriptionRepository.findByStripeId(subscriptionId);

    if (!previousSubscription) {
      if (throwOnMissing) {
        throw new SubscriptionRecordNotFoundError(subscriptionId);
      }
      logger.warn(
        { subscriptionId },
        "[stripeWebhook] No subscription record found, skipping sync",
      );
      return;
    }

    // Guard: a $0 invoice generated during cancellation must not reactivate the subscription.
    // Stripe fires invoice.payment_succeeded for $0 prorated invoices even when the subscription
    // is being cancelled. Check the authoritative Stripe status before activating.
    let stripeCanceled = false;
    try {
      const stripeSubscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      stripeCanceled = stripeSubscription.status === "canceled";
    } catch (err) {
      logger.warn(
        { subscriptionId, err },
        "[stripeWebhook] Failed to verify Stripe subscription status, proceeding with activation",
      );
      if (previousSubscription.status === SubscriptionStatus.CANCELLED) {
        logger.info(
          { subscriptionId },
          "[stripeWebhook] Stripe status unavailable and DB is CANCELLED, skipping activation",
        );
        return;
      }
    }

    if (stripeCanceled) {
      logger.info(
        { subscriptionId },
        "[stripeWebhook] Stripe subscription is canceled, skipping activation from $0 invoice",
      );
      return;
    }

    const updatedSubscription = await this.subscriptionRepository.activate({
      id: previousSubscription.id,
      previousStatus: previousSubscription.status,
    });

    if (!updatedSubscription) {
      return;
    }

    if (previousSubscription.status !== SubscriptionStatus.ACTIVE) {
      await this.clearTrialLicenseIfPresent(updatedSubscription, "subscription activated");

      if (isGrowthSeatEventPlan(updatedSubscription.plan)) {
        const oldSubscriptions = await this.subscriptionRepository.migrateToSeatEvent({
          organizationId: updatedSubscription.organizationId,
          excludeSubscriptionId: updatedSubscription.id,
        });

        // Cancel in Stripe after DB is consistent (outside transaction)
        for (const oldSub of oldSubscriptions) {
          if (oldSub.stripeSubscriptionId) {
            try {
              await this.stripe.subscriptions.cancel(oldSub.stripeSubscriptionId, {
                prorate: true,
              });
            } catch (err) {
              logger.error(
                { stripeSubscriptionId: oldSub.stripeSubscriptionId, err },
                "[stripeWebhook] CRITICAL: Failed to cancel old Stripe subscription during upgrade. Manual intervention required.",
              );
            }
          }
        }
      }

      await getApp().notifications.sendSlackSubscriptionEvent({
        type: "confirmed",
        organizationId: updatedSubscription.organizationId,
        organizationName: updatedSubscription.organization.name,
        plan: updatedSubscription.plan,
        subscriptionId: updatedSubscription.id,
        startDate: updatedSubscription.startDate,
        maxMembers: updatedSubscription.maxMembers,
        maxMessagesPerMonth: updatedSubscription.maxMessagesPerMonth,
      });

      fireSubscriptionSyncNurturing({
        organizationId: updatedSubscription.organizationId,
        hasSubscription: true,
      });
    }
  }

  private async clearTrialLicenseIfPresent(
    updatedSubscription: SubscriptionWithOrg,
    reason: string,
  ) {
    if (!updatedSubscription.organization.license) return;
    logger.info(
      { organizationId: updatedSubscription.organizationId },
      `[stripeWebhook] Clearing trial license — ${reason}`,
    );
    await this.organizationRepository.clearTrialLicense(
      updatedSubscription.organizationId,
    );
  }

  private normalizeSelectedCurrency(value?: string | null): Currency | null {
    if (value === Currency.EUR || value === Currency.USD) {
      return value;
    }
    return null;
  }
}
