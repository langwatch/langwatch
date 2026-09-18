import { z } from "zod";

export const billingStripeWebhookReceiptSchema = z.object({ received: z.literal(true) });

export const billingStripeWebhookHeadersSchema = z.object({
  "stripe-signature": z.string().optional(),
});
