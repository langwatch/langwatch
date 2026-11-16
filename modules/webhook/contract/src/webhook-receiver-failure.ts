import { z } from "zod";

/**
 * The field a failed request carries when the customer's own receiver caused it: it
 * answered a non-2xx status or could not be reached. Read by field, not class, so a
 * caller in another package recognises it without importing the process that threw it.
 */
export const WEBHOOK_RECEIVER_FAILURE = "webhookReceiverFailure";

/** What the receiver did; never its body, its headers or any secret. */
const webhookReceiverFailureSchema = z.object({
  /** The status it answered; null when it was never reached. */
  status: z.number().int().nullable(),
  /** 5xx, 408, 429 and an unreachable endpoint may pass; any other status will not. */
  retryable: z.boolean(),
});
export type WebhookReceiverFailure = z.infer<typeof webhookReceiverFailureSchema>;

/** The receiver's part in a failed request, or null when the failure is not the receiver's. */
export function findWebhookReceiverFailure(error: unknown): WebhookReceiverFailure | null {
  if (typeof error !== "object" || error === null) return null;
  const parsed = webhookReceiverFailureSchema.safeParse(
    Reflect.get(error, WEBHOOK_RECEIVER_FAILURE),
  );
  return parsed.success ? parsed.data : null;
}
