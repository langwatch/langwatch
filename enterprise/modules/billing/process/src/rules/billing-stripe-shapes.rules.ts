// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Billing's own shapes for the subscriptions, checkouts and invoices it holds at
 * Stripe (Q69 ruling "Stripe types": domain shapes). The http channels map them
 * to and from the SDK's; nothing here names Stripe.
 */

export type BillingSubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "paused"
  | "trialing"
  | "unpaid";

/** One line of a subscription: the price it bills, with that price's unit amount and interval. */
export type BillingSubscriptionItem = Readonly<{
  id: string;
  priceId: string;
  /** Null for a tiered or metered price. */
  unitAmount: number | null;
  /** Null for a one-time price. */
  interval: string | null;
}>;

/** The accrued amount at which the provider invoices mid-cycle, and whether that moves the anchor. */
type BillingThreshold = Readonly<{
  amountGte: number | null;
  resetBillingCycleAnchor: boolean | null;
}>;

export type BillingSubscription = Readonly<{
  id: string;
  status: BillingSubscriptionStatus;
  /** Set once a cancellation was asked for, even one scheduled for the period end. */
  canceledAt: number | null;
  billingThreshold: BillingThreshold | null;
  items: readonly BillingSubscriptionItem[];
}>;

/** A line change: an existing line by `id`, or a new one by `price`; these keys are the provider's. */
export type SubscriptionItemUpdate = {
  id?: string;
  price?: string;
  quantity?: number;
  deleted?: boolean;
};

/** What a subscription change asks for; an absent field is left as it is. */
export type BillingSubscriptionChange = {
  items?: SubscriptionItemUpdate[];
  /** Invoice the proration now rather than on the next cycle's invoice. */
  prorationBehavior?: "always_invoice";
  /** The instant, in epoch seconds, the proration is priced at. */
  prorationDate?: number;
  /** Lifts a cancellation scheduled for the period end. */
  cancelAtPeriodEnd?: false;
  billingThreshold?: { amountGte: number; resetBillingCycleAnchor: boolean };
};

/** A change an invoice preview can price: every change but the billing threshold. */
export type BillingSubscriptionPreviewChange = Omit<BillingSubscriptionChange, "billingThreshold">;

/** A previewed invoice's money figures, in the currency's minor unit. */
export type BillingInvoicePreview = Readonly<{
  total: number;
  amountDue: number;
  currency: string | null;
}>;

/** A price a checkout sells, and how many; no quantity for a metered price. */
type BillingCheckoutLineItem = { price?: string; quantity?: number };

/**
 * A subscription checkout. The provider fixes the rest of every checkout alike:
 * automatic tax, a required billing address, tax id collection, the customer's
 * address and name updated, and adaptive pricing off.
 */
export type BillingCheckoutRequest = {
  customerId: string;
  /** Lower-case ISO code the checkout is priced in. */
  currency: string;
  lineItems: BillingCheckoutLineItem[];
  metadata?: Record<string, string>;
  /** What the subscription the checkout creates starts with. */
  subscription?: {
    metadata: Record<string, string>;
    /** Epoch seconds. */
    billingCycleAnchor: number;
    prorationBehavior: "create_prorations";
  };
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  allowPromotionCodes: boolean;
};

/** A line a completed checkout sold. */
export type BillingPurchasedLineItem = Readonly<{
  priceId: string | null;
  quantity: number | null;
}>;

type BillingInvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

export type BillingInvoice = Readonly<{
  id: string;
  customerId: string | null;
  number: string | null;
  /** Epoch seconds. */
  created: number;
  amountDue: number;
  currency: string;
  status: BillingInvoiceStatus | null;
  pdfUrl: string | null;
  hostedUrl: string | null;
}>;
