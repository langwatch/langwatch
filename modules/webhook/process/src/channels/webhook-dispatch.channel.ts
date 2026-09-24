import type { WebhookSendInput, WebhookSendResult } from "@langwatch/egress";

/** The bytes of one batch out to one receiver URL; the destination choice is the service's. */
export interface WebhookDispatchChannel {
  send(input: WebhookSendInput): Promise<WebhookSendResult>;
}
