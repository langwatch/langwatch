// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { InvalidPlanError, type BankTransfer } from "@langwatch/enterprise-billing-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import Stripe from "stripe";

import {
  type ConnectedInvoicingChannel as ChannelShape,
  ConnectedInvoicingChannel,
  type ProviderInvoice,
} from "../connected-invoicing.channel.ts";

type CreateCustomerInput = Parameters<ChannelShape["createCustomer"]>[0];
type CreateSubscriptionInput = Parameters<ChannelShape["createUsageSubscription"]>[0];
type CreateGrantInput = Parameters<ChannelShape["createCreditGrant"]>[0];
type CreateInput = Parameters<ChannelShape["createOneOffInvoice"]>[0];
type FinalizedUsageInput = Parameters<ChannelShape["hasFinalizedUsageInvoice"]>[0];

const MILLISECONDS_PER_SECOND = 1000;
/** How many invoices of one subscription a renewal check reads. */
const INVOICE_PAGE_SIZE = 100;

/** How long an invoice may stay unpaid. */
export const INVOICE_DAYS_UNTIL_DUE = 30;

/**
 * The pinned SDK has no `billing.creditGrants`, so the one call the commit
 * needs is declared here against the API version that serves it. Everything
 * else on this channel keeps the SDK's own version.
 */
const CREDIT_GRANTS_API_VERSION = "2025-02-24.acacia";

const creditGrantMethods = {
  create: Stripe.StripeResource.method<{ id: string }>({
    method: "POST",
    fullPath: "/v1/billing/credit_grants",
  }),
};

const STRIPE_API_VERSION = "2024-04-10";

const CreditGrantsResource = Stripe.StripeResource.extend(creditGrantMethods);

type CreditGrants = Stripe.StripeResource & typeof creditGrantMethods;

/**
 * Everything here is invoiced, never charged: `send_invoice` with thirty days
 * to pay. A customer that can pay into a virtual bank account gets one through
 * the provider; a customer that cannot gets LangWatch's own bank details in the
 * invoice footer, and finance marks the invoice paid once the wire arrives.
 */
export class HttpConnectedInvoicingChannel extends ConnectedInvoicingChannel {
  private readonly creditGrants: CreditGrants;

  private constructor(
    private readonly stripe: Stripe,
    private readonly usagePriceId: () => string | undefined,
  ) {
    super();
    this.creditGrants = new CreditGrantsResource(stripe);
  }

  static create(input: {
    /** The payment provider's secret key, resolved through the secrets chain. */
    secretKey: string;
    /** The quarterly metered price, absent until that mode is provisioned. */
    usagePriceId: () => string | undefined;
  }): HttpConnectedInvoicingChannel {
    return new HttpConnectedInvoicingChannel(
      new Stripe(input.secretKey, { apiVersion: STRIPE_API_VERSION }),
      input.usagePriceId,
    );
  }

  async createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create(
      {
        name: input.name,
        email: input.email,
        metadata: { organization_id: input.organizationId },
        ...(input.invoiceFooter ? { invoice_settings: { footer: input.invoiceFooter } } : {}),
      },
      { idempotencyKey: `connected:customer:${input.organizationId}` },
    );

    return { id: customer.id };
  }

  async createUsageSubscription(
    input: CreateSubscriptionInput,
  ): Promise<{ id: string; itemId: string }> {
    const price = this.usagePriceId();
    if (!price) throw new InvalidPlanError("CONNECTED_HOSTED_USAGE_QUARTERLY");

    const anchor = epochSeconds(input.termStartsAt);
    const subscription = await this.stripe.subscriptions.create(
      {
        customer: input.customerId,
        items: [{ price }],
        currency: "usd",
        collection_method: "send_invoice",
        days_until_due: INVOICE_DAYS_UNTIL_DUE,
        // The provider only accepts an anchor it has not passed. A term that
        // started already anchors the cycle at creation, which is the same day.
        ...(anchor > epochSeconds(nowInstant()) ? { billing_cycle_anchor: anchor } : {}),
        ...withPaymentSettings(input.bankTransfer),
      },
      {
        idempotencyKey: `connected:subscription:${input.customerId}:${input.termStartsAt.toString()}`,
      },
    );

    const itemId = subscription.items.data[0]?.id;
    if (!itemId) throw new Error("The usage subscription was created without its item");

    return { id: subscription.id, itemId };
  }

  async createCreditGrant(input: CreateGrantInput): Promise<{ id: string }> {
    // The pinned SDK types these methods as answering the value rather than the
    // promise they return, so the call is lifted to a promise before awaiting.
    const grant = await Promise.resolve(
      this.creditGrants.create(
        {
          customer: input.customerId,
          name: input.name,
          category: "paid",
          amount: { type: "monetary", monetary: { currency: "usd", value: input.amountUsdCents } },
          // Metered only, so a seat invoice can never draw the usage commit down.
          applicability_config: { scope: { price_type: "metered" } },
          expires_at: epochSeconds(input.expiresAt),
          metadata: input.metadata,
        },
        {
          apiVersion: CREDIT_GRANTS_API_VERSION,
          idempotencyKey: `connected:grant:${input.customerId}:${metadataKey(input.metadata)}`,
        },
      ),
    );

    return { id: grant.id };
  }

  async createOneOffInvoice(input: CreateInput): Promise<ProviderInvoice> {
    const currency = input.currency.toLowerCase();
    const key = `connected:invoice:${input.customerId}:${metadataKey(input.metadata)}`;
    // The draft comes first and every line names it, so a pending item left by
    // another invoice in flight for the same customer never rides along, and a
    // retry with the same key reaches the same objects.
    const draft = await this.stripe.invoices.create(
      {
        customer: input.customerId,
        currency,
        collection_method: "send_invoice",
        days_until_due: INVOICE_DAYS_UNTIL_DUE,
        pending_invoice_items_behavior: "exclude",
        auto_advance: false,
        metadata: input.metadata,
        ...withPaymentSettings(input.bankTransfer),
      },
      { idempotencyKey: key },
    );

    for (const [index, line] of input.lines.entries()) {
      await this.stripe.invoiceItems.create(
        {
          customer: input.customerId,
          invoice: draft.id,
          currency,
          description: line.description,
          // A line with a quantity carries the unit and the count, so the
          // customer reads "8 seats at 300.82" and the two multiply back to
          // the total.
          ...(line.quantity !== undefined && line.unitAmountCents !== undefined
            ? { quantity: line.quantity, unit_amount: line.unitAmountCents }
            : { amount: line.amountCents }),
        },
        { idempotencyKey: `${key}:line:${index}` },
      );
    }

    return toProviderInvoice(
      await this.stripe.invoices.finalizeInvoice(
        draft.id,
        {},
        { idempotencyKey: `${key}:finalize` },
      ),
    );
  }

  async getInvoice(stripeInvoiceId: string): Promise<ProviderInvoice> {
    return toProviderInvoice(await this.stripe.invoices.retrieve(stripeInvoiceId));
  }

  async hasFinalizedUsageInvoice(input: FinalizedUsageInput): Promise<boolean> {
    const invoices = await this.stripe.invoices.list({
      subscription: input.subscriptionId,
      limit: INVOICE_PAGE_SIZE,
    });

    return invoices.data.some(
      (invoice) =>
        invoice.status !== "draft" &&
        invoice.period_end * MILLISECONDS_PER_SECOND >= input.periodEnd.epochMilliseconds,
    );
  }

  async payOutOfBand(stripeInvoiceId: string): Promise<void> {
    await this.stripe.invoices.pay(stripeInvoiceId, { paid_out_of_band: true });
  }
}

function epochSeconds(moment: Instant): number {
  return Math.floor(moment.epochMilliseconds / MILLISECONDS_PER_SECOND);
}

function toProviderInvoice(invoice: Stripe.Invoice): ProviderInvoice {
  const subscription =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : (invoice.subscription?.id ?? null);

  return {
    id: invoice.id,
    status: invoice.status ?? "draft",
    currency: invoice.currency,
    amountDueCents: invoice.amount_due,
    subscriptionId: subscription,
    periodEndMs: invoice.period_end ? invoice.period_end * MILLISECONDS_PER_SECOND : null,
  };
}

/**
 * Bank transfer needs `send_invoice`, which everything here already is. The
 * type is the customer's: a US dollar account takes `us_bank_transfer`, a euro
 * account `eu_bank_transfer` and the country it is held in.
 */
function withPaymentSettings(
  bankTransfer: BankTransfer | null,
): { payment_settings: Stripe.InvoiceCreateParams.PaymentSettings } | Record<string, never> {
  if (!bankTransfer) return {};

  return {
    payment_settings: {
      payment_method_types: ["customer_balance"],
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer",
          bank_transfer: {
            type: bankTransfer.type,
            ...(bankTransfer.country
              ? { eu_bank_transfer: { country: bankTransfer.country } }
              : {}),
          },
        },
      },
    },
  };
}

/** The metadata, in key order, as the idempotency key's tail. */
function metadataKey(metadata: Record<string, string>): string {
  return Object.keys(metadata)
    .toSorted()
    .map((name) => `${name}=${metadata[name]}`)
    .join(",");
}
