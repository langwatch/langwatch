// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import type Stripe from "stripe";

import type { StripeSubscriptionsChannel } from "../../../channels/stripe-subscriptions.channel.ts";
import type { BillingWebhookSubscriptionRepository } from "../../../repositories/billing-webhook-subscription.repository.ts";
import type { LicenseRenewalClaimRepository } from "../../../repositories/license-renewal-claim.repository.ts";
import type { GeneratedLicense, LicenseRenewal } from "./license-purchase.service.ts";

/** Mints and mails a renewal in two steps, so a failed mail is retried without minting again. */
export type LicenseRenewalIssuer = {
  mintRenewal(renewal: LicenseRenewal): Promise<GeneratedLicense>;
  sendRenewal(input: { renewal: LicenseRenewal; license: GeneratedLicense }): Promise<void>;
};

const logger = createLogger("langwatch:billing:licenseRenewal");

/** Longer than signing, recording and mailing one licence take; a stale claim is taken over after it. */
export const LICENSE_RENEWAL_CLAIM_LEASE_MS = 5 * 60 * 1000;

/** The fields of a paid Stripe invoice a renewal reads. */
export type RenewalInvoice = Pick<
  Stripe.Invoice,
  "id" | "billing_reason" | "customer_email" | "customer_name" | "amount_paid" | "currency"
> & {
  subscription: string | { id: string } | null;
  lines: { data: readonly Pick<Stripe.InvoiceLineItem, "type" | "quantity" | "period">[] };
};

export type LicenseRenewalOutcome =
  /** Not a renewal of a self-serve licence subscription: the caller carries on. */
  | "not_license_renewal"
  | "renewed"
  /** This invoice's licence went out already. */
  | "already_delivered"
  /** Another delivery of this invoice holds the claim; Stripe should retry. */
  | "in_flight";

/**
 * Mints the next term's licence when a self-serve licence subscription renews
 * (specs/licensing/self-serving-license-purchase.feature). A subscription is a
 * licence one when the checkout that created it came through the licence
 * payment link, so subscriptions bought before this existed are recognised.
 */
export class LicenseRenewalService {
  private constructor(
    private readonly deps: {
      licensePaymentLinkId: string;
      subscriptions: Pick<BillingWebhookSubscriptionRepository, "findByStripeId">;
      stripeSubscriptions: Pick<StripeSubscriptionsChannel, "findSubscriptionCheckouts">;
      claims: LicenseRenewalClaimRepository;
      issuer: LicenseRenewalIssuer;
      now: () => Instant;
    },
  ) {}

  static create(options: {
    licensePaymentLinkId: string;
    subscriptions: Pick<BillingWebhookSubscriptionRepository, "findByStripeId">;
    stripeSubscriptions: Pick<StripeSubscriptionsChannel, "findSubscriptionCheckouts">;
    claims: LicenseRenewalClaimRepository;
    issuer: LicenseRenewalIssuer;
    now?: () => Instant;
  }): LicenseRenewalService {
    return new LicenseRenewalService({ ...options, now: options.now ?? nowInstant });
  }

  async handleInvoice({ invoice }: { invoice: RenewalInvoice }): Promise<LicenseRenewalOutcome> {
    if (invoice.billing_reason !== "subscription_cycle") return "not_license_renewal";
    const subscriptionId =
      typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
    if (!subscriptionId) return "not_license_renewal";
    if (!(await this.isLicenseSubscription(subscriptionId))) return "not_license_renewal";

    const claim = await this.deps.claims.claim({
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: subscriptionId,
      now: this.deps.now(),
      leaseMs: LICENSE_RENEWAL_CLAIM_LEASE_MS,
    });
    if (claim.outcome === "delivered") {
      logger.info({ invoiceId: invoice.id }, "License renewal already delivered for this invoice");
      return "already_delivered";
    }
    if (claim.outcome === "in_flight") return "in_flight";

    const held = { stripeInvoiceId: invoice.id, token: claim.token };
    try {
      const renewal = renewalOf(invoice);
      const license = claim.issued ?? (await this.mintAndKeep({ renewal, held }));
      if (!license) return "in_flight";
      await this.deps.issuer.sendRenewal({ renewal, license });
      const { licenseId } = license.licenseData;
      if (
        !(await this.deps.claims.markDelivered({
          ...held,
          licenseId,
          deliveredAt: this.deps.now(),
        }))
      ) {
        logger.warn(
          { invoiceId: invoice.id, licenseId },
          "License renewal claim was taken over while mailing",
        );
      }
      logger.info({ invoiceId: invoice.id, licenseId }, "License renewal delivered");
      return "renewed";
    } catch (error) {
      await this.deps.claims.release(held);
      throw error;
    }
  }

  /** Null when another delivery took the claim over before the licence could be kept on it. */
  private async mintAndKeep({
    renewal,
    held,
  }: {
    renewal: LicenseRenewal;
    held: { stripeInvoiceId: string; token: string };
  }): Promise<GeneratedLicense | null> {
    const license = await this.deps.issuer.mintRenewal(renewal);
    if (await this.deps.claims.recordIssued({ ...held, issued: license })) return license;
    logger.error(
      { invoiceId: held.stripeInvoiceId, licenseId: license.licenseData.licenseId },
      "License renewal claim was taken over after minting; this licence is not mailed",
    );
    return null;
  }

  /** A subscription billing knows is a Cloud plan, so only unknown ones cost a Stripe read. */
  private async isLicenseSubscription(subscriptionId: string): Promise<boolean> {
    if (await this.deps.subscriptions.findByStripeId(subscriptionId)) return false;
    const checkouts = await this.deps.stripeSubscriptions.findSubscriptionCheckouts({
      subscriptionId,
    });
    return checkouts.some((checkout) => checkout.paymentLinkId === this.deps.licensePaymentLinkId);
  }
}

function renewalOf(invoice: RenewalInvoice): LicenseRenewal {
  const email = invoice.customer_email;
  if (!email) throw new Error(`License renewal invoice ${invoice.id} has no customer email`);
  const line =
    invoice.lines.data.find((candidate) => candidate.type === "subscription") ??
    invoice.lines.data[0];
  if (!line) throw new Error(`License renewal invoice ${invoice.id} has no line items`);
  return {
    email,
    organizationName: invoice.customer_name ?? "",
    seats: line.quantity ?? 1,
    expiresAt: Temporal.Instant.fromEpochMilliseconds(line.period.end * 1000),
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
  };
}
