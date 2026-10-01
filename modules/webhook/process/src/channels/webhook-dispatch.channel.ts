import type { WebhookSendResult } from "../rules/webhook-delivery-classification.rules.ts";
import type { WebhookSendInput } from "../services/webhook-egress.service.ts";

/** The bytes of one batch out to one receiver URL; the destination choice is the service's. */
export interface WebhookDispatchChannel {
  send(input: WebhookSendInput): Promise<WebhookSendResult>;
}
