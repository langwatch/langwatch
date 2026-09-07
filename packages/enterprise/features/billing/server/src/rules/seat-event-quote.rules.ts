/**
 * The pure shape and arithmetic behind a seat-change quote: what a previewed invoice's two
 * money figures mean, the Stripe parameters a seat quantity change is made with, and how long
 * a quote stays confirmable. No Stripe call and no database read happens here.
 */
import type Stripe from "stripe";
import { QuoteExpiredError } from "@langwatch/enterprise-billing-contract";

export type InviteInput = {
  email: string;
  role: string;
  teamIds: string;
};

export type SeatEventDatabase = {
  subscription: {
    findMany(args: any): Promise<any[]>;
    updateMany(args: any): Promise<{ count: number }>;
    update(args: any): Promise<any>;
  };
  organizationInvite: { deleteMany(args: any): Promise<{ count: number }> };
  $transaction<T>(run: (transaction: any) => Promise<T>): Promise<T>;
};

/**
 * The two fields a seat quote is allowed to read, and the only invoice they mean anything
 * on: an `always_invoice` preview, where the invoice IS the immediate one — only the
 * proration lines, not next cycle's recurring and metered usage.
 */
export type AlwaysInvoicePreview = Pick<Stripe.Invoice, "total" | "amount_due">;

/**
 * The two money figures a seat quote reports, read off a previewed invoice.
 */
export const quotedAmounts = (preview: AlwaysInvoicePreview) => {
  const invoiceTotalCents = preview.total;
  const isCredit = invoiceTotalCents < 0;

  return {
    prorationCents: isCredit ? invoiceTotalCents : preview.amount_due,
    // Credit spent on this invoice, so the dialog can explain a "Due today"
    // smaller than the change itself. Zero on a clean account, and never
    // reported for a credit — nothing is drawn down by one.
    creditAppliedCents: isCredit ? 0 : invoiceTotalCents - preview.amount_due,
  };
};

/**
 * The seat change itself — read by BOTH the preview and the update, so the quote cannot
 * describe a different operation from the one performed.
 */
export const seatChangeParams = ({
  stripeSubscription,
  seatItem,
  quantity,
  prorationDate,
}: {
  stripeSubscription: Stripe.Subscription;
  seatItem: Stripe.SubscriptionItem;
  quantity: number;
  prorationDate: number;
}) => {
  const params: {
    cancel_at_period_end?: false;
    items: Array<{ id: string; quantity: number }>;
    proration_behavior: "always_invoice";
    proration_date: number;
  } = {
    items: [{ id: seatItem.id, quantity }],
    proration_behavior: "always_invoice",
    // Prorations are priced by the moment they are applied, so a quote issued
    // at one instant and confirmed at another are two different amounts. The
    // quote issues this timestamp and the confirmation sends it back, which
    // makes the charge reproduce the number the customer read rather than
    // merely resemble it.
    proration_date: prorationDate,
  };
  if (stripeSubscription.canceled_at) {
    params.cancel_at_period_end = false;
  }

  return params;
};

/**
 * How long a quote may be confirmed against the instant it priced.
 */
export const QUOTE_VALIDITY_SECONDS = 15 * 60;

/**
 * The instant to price a seat change at.
 */
export const resolveProrationDate = (quotedAt: number | undefined) => {
  const now = Math.floor(Date.now() / 1000);
  if (quotedAt === undefined) {
    return now;
  }

  const age = now - quotedAt;
  if (age < 0 || age > QUOTE_VALIDITY_SECONDS) {
    throw new QuoteExpiredError();
  }

  return quotedAt;
};

/** What the seat-change dialog shows before the customer confirms. */
export type SeatEventProrationQuote = {
  /** Signed: removing seats previews a negative amount. */
  amountDueCents: number;
  formattedAmountDue: string;
  /** Null rather than a formatted zero, so an account with no credit says nothing. */
  formattedCreditApplied: string | null;
  formattedRecurringTotal: string;
  billingInterval: string;
  /** The instant this quote priced, in epoch milliseconds, sent back on confirm. */
  quotedAt: number;
};
