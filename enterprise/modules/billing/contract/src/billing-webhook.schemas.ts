import { z } from "zod";

export const billingStripeWebhookReceiptSchema = z.object({ received: z.literal(true) });

export const billingStripeWebhookHeadersSchema = z.object({
  "stripe-signature": z.string().optional(),
});

/** How one delivered event was handled: a 400 tells Stripe not to retry, a 500 asks it to. */
export type HandleEventResult =
  | { status: "ok" }
  | { status: "error"; httpStatus: 400 | 500; message: string };
