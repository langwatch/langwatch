/**
 * The payment provider behind connected billing (ADR-141, section 7).
 *
 * Everything here is invoiced, never charged: `send_invoice` with thirty days
 * to pay on the subscription and on every one-off invoice. A customer that can
 * pay into a virtual bank account gets one through the provider; a customer
 * that cannot gets LangWatch's own bank details in the invoice footer, and
 * finance marks the invoice paid once the wire arrives.
 */

import type Stripe from "stripe";
import { InvalidPlanError } from "../errors";
import type { CreditGrants } from "../stripe/creditGrants";
import type {
  BankTransfer,
  ConnectedBillingProvider,
  ConnectedCurrency,
  InvoiceLine,
  ProviderInvoice,
} from "./connectedBilling.service";
import { INVOICE_DAYS_UNTIL_DUE } from "./connectedBilling.service";

const MILLISECONDS_PER_SECOND = 1000;
/** How many invoices of one subscription a renewal check reads. */
const INVOICE_PAGE_SIZE = 100;

const epochSeconds = (date: Date): number =>
  Math.floor(date.getTime() / MILLISECONDS_PER_SECOND);

/**
 * Bank transfer needs `send_invoice`, which everything here already is. The
 * type is the customer's: a US dollar account takes `us_bank_transfer`, a euro
 * account `eu_bank_transfer` and the country it is held in.
 */
function paymentSettings(
  bankTransfer: BankTransfer | null,
): Stripe.SubscriptionCreateParams.PaymentSettings | undefined {
  if (!bankTransfer) return undefined;
  return {
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
  };
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
    periodEnd: invoice.period_end
      ? new Date(invoice.period_end * MILLISECONDS_PER_SECOND)
      : null,
  };
}

export interface StripeConnectedBillingProviderDeps {
  stripe: Stripe;
  creditGrants: CreditGrants;
  /** The quarterly metered price from the catalog, absent until it is mapped. */
  usagePriceId: () => string | undefined;
}

export class StripeConnectedBillingProvider
  implements ConnectedBillingProvider
{
  constructor(private readonly deps: StripeConnectedBillingProviderDeps) {}

  async createCustomer(input: {
    organizationId: string;
    name: string;
    email: string;
    bankTransfer: BankTransfer | null;
    invoiceFooter: string | null;
  }): Promise<{ id: string }> {
    const customer = await this.deps.stripe.customers.create(
      {
        name: input.name,
        email: input.email,
        metadata: { organization_id: input.organizationId },
        ...(input.invoiceFooter
          ? { invoice_settings: { footer: input.invoiceFooter } }
          : {}),
      },
      { idempotencyKey: `connected:customer:${input.organizationId}` },
    );
    return { id: customer.id };
  }

  async createUsageSubscription(input: {
    customerId: string;
    termStartsAt: Date;
    bankTransfer: BankTransfer | null;
  }): Promise<{ id: string; itemId: string }> {
    const price = this.deps.usagePriceId();
    if (!price) throw new InvalidPlanError("CONNECTED_HOSTED_USAGE_QUARTERLY");

    const anchor = epochSeconds(input.termStartsAt);
    const subscription = await this.deps.stripe.subscriptions.create(
      {
        customer: input.customerId,
        items: [{ price }],
        currency: "usd",
        collection_method: "send_invoice",
        days_until_due: INVOICE_DAYS_UNTIL_DUE,
        // The provider only accepts an anchor it has not passed. A term that
        // started already anchors the cycle at creation, which is the same day.
        ...(anchor > epochSeconds(new Date())
          ? { billing_cycle_anchor: anchor }
          : {}),
        ...withPaymentSettings(input.bankTransfer),
      },
      {
        idempotencyKey: `connected:subscription:${input.customerId}:${input.termStartsAt.toISOString()}`,
      },
    );
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
      throw new Error("The usage subscription was created without its item");
    }
    return { id: subscription.id, itemId };
  }

  async createCreditGrant(input: {
    customerId: string;
    name: string;
    amountUsdCents: number;
    expiresAt: Date;
    metadata: Record<string, string>;
  }): Promise<{ id: string }> {
    const grant = await this.deps.creditGrants.create(
      {
        customer: input.customerId,
        name: input.name,
        category: "paid",
        amount: {
          type: "monetary",
          monetary: { currency: "usd", value: input.amountUsdCents },
        },
        // Metered only, so a seat invoice can never draw the usage commit down.
        applicability_config: { scope: { price_type: "metered" } },
        expires_at: epochSeconds(input.expiresAt),
        metadata: input.metadata,
      },
      {
        idempotencyKey: `connected:grant:${input.customerId}:${metadataKey(input.metadata)}`,
      },
    );
    return { id: grant.id };
  }

  async createOneOffInvoice(input: {
    customerId: string;
    currency: ConnectedCurrency;
    lines: InvoiceLine[];
    bankTransfer: BankTransfer | null;
    metadata: Record<string, string>;
  }): Promise<ProviderInvoice> {
    const currency = input.currency.toLowerCase();
    const key = `connected:invoice:${input.customerId}:${metadataKey(input.metadata)}`;
    // The draft comes first and every line names it, so a pending item left
    // by another invoice in flight for the same customer never rides along,
    // and a retry with the same key reaches the same objects.
    const draft = await this.deps.stripe.invoices.create(
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
      await this.deps.stripe.invoiceItems.create(
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
    const finalized = await this.deps.stripe.invoices.finalizeInvoice(
      draft.id,
      {},
      { idempotencyKey: `${key}:finalize` },
    );
    return toProviderInvoice(finalized);
  }

  async retrieveInvoice(id: string): Promise<ProviderInvoice> {
    return toProviderInvoice(await this.deps.stripe.invoices.retrieve(id));
  }

  async hasFinalizedUsageInvoice(input: {
    subscriptionId: string;
    periodEnd: Date;
  }): Promise<boolean> {
    const invoices = await this.deps.stripe.invoices.list({
      subscription: input.subscriptionId,
      limit: INVOICE_PAGE_SIZE,
    });
    return invoices.data.some(
      (invoice) =>
        invoice.status !== "draft" &&
        invoice.period_end * MILLISECONDS_PER_SECOND >=
          input.periodEnd.getTime(),
    );
  }

  async payOutOfBand(invoiceId: string): Promise<void> {
    await this.deps.stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
  }
}

/** The metadata, in key order, as the idempotency key's tail. */
function metadataKey(metadata: Record<string, string>): string {
  return Object.keys(metadata)
    .sort()
    .map((name) => `${name}=${metadata[name]}`)
    .join(",");
}

function withPaymentSettings(bankTransfer: BankTransfer | null) {
  const settings = paymentSettings(bankTransfer);
  return settings ? { payment_settings: settings } : {};
}
