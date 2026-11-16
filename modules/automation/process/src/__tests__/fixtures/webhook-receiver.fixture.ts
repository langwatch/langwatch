import { DispatchError } from "@langwatch/eventing";
import { WEBHOOK_RECEIVER_FAILURE } from "@langwatch/webhook-contract";

/** What the webhook module throws when an automation's own receiver answers `status`. */
export function webhookReceiverRefusal({
  status,
  retryable,
}: {
  status: number;
  retryable: boolean;
}): DispatchError {
  const refusal = new DispatchError({
    message: `Webhook for trigger "Alert" received HTTP ${status}: Token not found`,
    retryable,
    customerMessage: `The endpoint answered HTTP ${status}.`,
  });
  return Object.assign(refusal, { [WEBHOOK_RECEIVER_FAILURE]: { status, retryable } });
}
