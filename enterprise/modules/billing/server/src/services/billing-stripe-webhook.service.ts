import { createLogger } from "@langwatch/observability";
import type { PostHog } from "posthog-node";
import type Stripe from "stripe";
import { type StripePriceMap } from "@langwatch/enterprise-billing-contract";
import { BestEffortService } from "./best-effort.service.ts";
import type { SubscriptionItemCalculatorService } from "./subscription-item-calculator.service.ts";
import type { BillingWebhookHost } from "../ports/billing-webhook-host.port.ts";
import type { BillingWebhookOrganization } from "../repositories/billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscription } from "../repositories/billing-webhook-subscription.repository.ts";
import { BillingSubscriptionLifecycleService } from "./billing-subscription-lifecycle.service.ts";
import {
  BillingCheckoutCompletionService,
  type InviteApprover,
} from "./billing-checkout-completion.service.ts";

const logger = createLogger("langwatch:billing:webhookService");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

type ItemCalculator = Pick<SubscriptionItemCalculatorService, "calculateQuantityForPrice"> & {
  readonly prices: StripePriceMap;
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
   * Dispatches a verified Stripe event to the right handler. Transport-agnostic
   * so it's reusable from workers, replays, and tests. Unexpected throws
   * return a 500 so Stripe retries with backoff.
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

  handleInvoicePaymentFailed(params: { subscriptionId: string }): Promise<void>;

  handleSubscriptionDeleted(params: { stripeSubscriptionId: string }): Promise<void>;

  handleSubscriptionUpdated(params: { subscription: Stripe.Subscription }): Promise<void>;
};

export class EEWebhookService implements WebhookService {
  private readonly subscriptionRepository: BillingWebhookSubscription;
  private readonly organizationRepository: BillingWebhookOrganization;
  private readonly stripe: Stripe;
  private readonly itemCalculator: ItemCalculator;
  private readonly inviteApprover?: InviteApprover;
  private readonly licensePurchaseHandler?: LicensePurchaseHandler;
  private readonly licensePaymentLinkId?: string;
  private readonly licensePrivateKey?: string;
  private readonly getPostHog?: () => PostHog | null;
  private readonly host: BillingWebhookHost;
  private readonly bestEffort = BestEffortService.create();
  private readonly lifecycle: BillingSubscriptionLifecycleService;
  private readonly checkout: BillingCheckoutCompletionService;

  private constructor({
    subscriptionRepository,
    organizationRepository,
    stripe,
    itemCalculator,
    inviteApprover,
    licensePurchaseHandler,
    licensePaymentLinkId,
    licensePrivateKey,
    getPostHog,
    host,
  }: {
    subscriptionRepository: BillingWebhookSubscription;
    organizationRepository: BillingWebhookOrganization;
    stripe: Stripe;
    itemCalculator: ItemCalculator;
    inviteApprover?: InviteApprover;
    licensePurchaseHandler?: LicensePurchaseHandler;
    licensePaymentLinkId?: string;
    licensePrivateKey?: string;
    getPostHog?: () => PostHog | null;
    host: BillingWebhookHost;
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
    this.host = host;
    this.checkout = BillingCheckoutCompletionService.create({
      subscriptionRepository,
      organizationRepository,
      stripe,
      itemCalculator,
      inviteApprover,
      getPostHog,
      host,
    });
    this.lifecycle = BillingSubscriptionLifecycleService.create({
      subscriptionRepository,
      organizationRepository,
      stripe,
      itemCalculator,
      host,
    });
  }

  static create(options: {
    subscriptionRepository: BillingWebhookSubscription;
    organizationRepository: BillingWebhookOrganization;
    stripe: Stripe;
    itemCalculator: ItemCalculator;
    inviteApprover?: InviteApprover;
    licensePurchaseHandler?: LicensePurchaseHandler;
    licensePaymentLinkId?: string;
    licensePrivateKey?: string;
    getPostHog?: () => PostHog | null;
    host: BillingWebhookHost;
  }): EEWebhookService {
    return new EEWebhookService(options);
  }

  async handleEvent(event: Stripe.Event): Promise<HandleEventResult> {
    try {
      if (event.type === "checkout.session.completed") {
        const licenseResult = await this.tryRouteLicensePurchase(event);
        if (licenseResult) {
          return licenseResult;
        }
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

    if (!this.licensePaymentLinkId || paymentLinkId !== this.licensePaymentLinkId) {
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
      type: "checkout.session.completed" | "invoice.payment_succeeded" | "invoice.payment_failed";
    },
  ): Promise<HandleEventResult> {
    const paymentIntent = event.data.object as Stripe.Checkout.Session | Stripe.Invoice;

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
      ? await this.organizationRepository.tryFindByStripeCustomerId(customerId)
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
        await this.checkout.dispatchCheckoutCompleted({
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

  async handleCheckoutCompleted(params: {
    subscriptionId: string;
    clientReferenceId: string | null;
    selectedCurrency?: string | null;
  }): Promise<{ earlyReturn: boolean }> {
    return this.checkout.handleCheckoutCompleted(params);
  }

  async handleInvoicePaymentSucceeded({
    subscriptionId,
    throwOnMissing,
  }: {
    subscriptionId: string;
    throwOnMissing?: boolean;
  }): Promise<void> {
    await this.lifecycle.syncInvoicePaymentSuccess({ subscriptionId, throwOnMissing });
  }

  async handleInvoicePaymentFailed({ subscriptionId }: { subscriptionId: string }): Promise<void> {
    await waitForStripeConsistency();

    const currentSubscription = await this.subscriptionRepository.tryFindByStripeId(subscriptionId);

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

  async handleSubscriptionDeleted(params: { stripeSubscriptionId: string }): Promise<void> {
    await this.lifecycle.handleSubscriptionDeleted(params);
  }

  async handleSubscriptionUpdated(params: { subscription: Stripe.Subscription }): Promise<void> {
    await this.lifecycle.handleSubscriptionUpdated(params);
  }
}
