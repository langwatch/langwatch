import { QuoteExpiredError, type SubscriptionInvite } from "@langwatch/enterprise-billing-contract";
import { nowInstant } from "@langwatch/time";

/**
 * The pure shape and arithmetic behind a seat-change quote: what a previewed invoice's two
 * money figures mean, the change a seat quantity change is made with, and how long a quote
 * stays confirmable. No Stripe call and no database read happens here.
 */
import type {
  BillingInvoicePreview,
  BillingSubscription,
  BillingSubscriptionItem,
} from "./billing-stripe-shapes.rules.ts";

export type InviteInput = {
  email: string;
  role: SubscriptionInvite["role"];
  teamIds: string;
};

/**
 * The two fields a seat quote is allowed to read, and the only invoice they mean anything
 * on: an `always_invoice` preview, where the invoice IS the immediate one — only the
 * proration lines, not next cycle's recurring and metered usage.
 */
type AlwaysInvoicePreview = Pick<BillingInvoicePreview, "total" | "amountDue">;

/**
 * The two money figures a seat quote reports, read off a previewed invoice.
 */
export const quotedAmounts = (
  preview: AlwaysInvoicePreview,
): { prorationCents: number; creditAppliedCents: number } => {
  const invoiceTotalCents = preview.total;
  const isCredit = invoiceTotalCents < 0;

  return {
    prorationCents: isCredit ? invoiceTotalCents : preview.amountDue,
    // Credit spent on this invoice, so the dialog can explain a "Due today"
    // smaller than the change itself. Zero on a clean account, and never
    // reported for a credit — nothing is drawn down by one.
    creditAppliedCents: isCredit ? 0 : invoiceTotalCents - preview.amountDue,
  };
};

type SeatChange = {
  cancelAtPeriodEnd?: false;
  items: { id: string; quantity: number }[];
  prorationBehavior: "always_invoice";
  prorationDate: number;
};

/**
 * The seat change itself — read by BOTH the preview and the update, so the quote cannot
 * describe a different operation from the one performed.
 */
export const seatChange = ({
  subscription,
  seatItem,
  quantity,
  prorationDate,
}: {
  subscription: Pick<BillingSubscription, "canceledAt">;
  seatItem: Pick<BillingSubscriptionItem, "id">;
  quantity: number;
  prorationDate: number;
}): SeatChange => {
  const change: SeatChange = {
    items: [{ id: seatItem.id, quantity }],
    prorationBehavior: "always_invoice",
    // Prorations are priced by the moment they are applied, so a quote issued
    // at one instant and confirmed at another are two different amounts. The
    // quote issues this timestamp and the confirmation sends it back, which
    // makes the charge reproduce the number the customer read rather than
    // merely resemble it.
    prorationDate,
  };
  if (subscription.canceledAt) {
    change.cancelAtPeriodEnd = false;
  }

  return change;
};

/**
 * How long a quote may be confirmed against the instant it priced.
 */
export const QUOTE_VALIDITY_SECONDS = 15 * 60;

/**
 * The instant to price a seat change at.
 */
export const resolveProrationDate = (quotedAt: number | undefined): number => {
  const now = Math.floor(nowInstant().epochMilliseconds / 1000);
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
