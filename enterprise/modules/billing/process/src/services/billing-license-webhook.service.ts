import { type HandleEventResult } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  LicenseRenewalOutcome,
  RenewalInvoice,
} from "../features/license-purchase/services/license-renewal.service.ts";

const logger = createLogger("langwatch:billing:webhookService");

/**
 * License purchase events originate from a specific Stripe payment link and
 * target self-hosted buyers who have no organization in the SaaS database.
 * The webhook service routes these before any org lookup.
 */
export interface LicensePurchaseHandler {
  handle(params: {
    checkoutSession: Stripe.Checkout.Session;
    stripeSubscriptions: Pick<StripeSubscriptionsChannel, "listCheckoutLineItems">;
  }): Promise<void>;
}

/** Mints the next term's licence for a renewed self-serve licence subscription. */
export interface LicenseRenewalHandler {
  handleInvoice(input: { invoice: RenewalInvoice }): Promise<LicenseRenewalOutcome>;
}

/** A licence event answers Stripe; anything else goes on to the subscription flow. */
export type LicenseRouting =
  | { outcome: "handled"; result: HandleEventResult }
  | { outcome: "not_license" };

type LicenseWebhookOptions = {
  stripeSubscriptions: StripeSubscriptionsChannel;
  licensePurchaseHandler?: LicensePurchaseHandler;
  licensePaymentLinkId?: string;
  licenseRenewal?: LicenseRenewalHandler;
};

/** The self-hosted licence events of the Stripe webhook: a purchase and a paid renewal. */
export class BillingLicenseWebhookService {
  static create(options: LicenseWebhookOptions): BillingLicenseWebhookService {
    return new BillingLicenseWebhookService(options);
  }

  private constructor(private readonly options: LicenseWebhookOptions) {}

  /**
   * Handled when the session is a license purchase; otherwise the webhook falls through to the
   * subscription flow.
   */
  async routePurchase(
    event: Stripe.Event & { type: "checkout.session.completed" },
  ): Promise<LicenseRouting> {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;

    const paymentLinkId =
      typeof checkoutSession.payment_link === "string"
        ? checkoutSession.payment_link
        : checkoutSession.payment_link?.id;

    const { licensePaymentLinkId, licensePurchaseHandler } = this.options;
    if (!licensePaymentLinkId || paymentLinkId !== licensePaymentLinkId) {
      return { outcome: "not_license" };
    }

    if (!licensePurchaseHandler) {
      logger.error(
        { eventId: event.id },
        "[stripeWebhook] License purchase handler is not configured",
      );

      return {
        outcome: "handled",
        result: {
          status: "error",
          httpStatus: 500,
          message: "License generation error: handler not configured",
        },
      };
    }

    await licensePurchaseHandler.handle({
      checkoutSession,
      stripeSubscriptions: this.options.stripeSubscriptions,
    });

    return { outcome: "handled", result: { status: "ok" } };
  }

  /**
   * A paid renewal of a licence subscription gets its next term's licence;
   * anything else goes on. Both paid events of one invoice
   * arrive: the per-invoice claim lets only the first mint.
   */
  async routeRenewal(
    event: Stripe.Event & { type: "invoice.paid" | "invoice.payment_succeeded" },
  ): Promise<LicenseRouting> {
    if (!this.options.licenseRenewal) return { outcome: "not_license" };
    const outcome = await this.options.licenseRenewal.handleInvoice({
      invoice: event.data.object,
    });
    if (outcome === "not_license_renewal") return { outcome: "not_license" };
    if (outcome === "in_flight") {
      logger.warn(
        { eventId: event.id, eventType: event.type },
        "[stripeWebhook] License renewal for this invoice is in flight; asking Stripe to retry",
      );
      return {
        outcome: "handled",
        result: { status: "error", httpStatus: 500, message: "License renewal in progress" },
      };
    }
    return { outcome: "handled", result: { status: "ok" } };
  }
}
