import type { WebhookDispatchResult } from "../app/webhook.app.ts";
import type { WebhookDeliveryProcessDeps } from "../services/webhook-delivery.service.ts";

export type WebhookDispatchInput = Parameters<WebhookDeliveryProcessDeps["dispatch"]>[0];

/** One endpoint's last hop: a frozen batch out to the receiver the endpoint names. */
export interface WebhookDispatchChannel {
  dispatch(input: WebhookDispatchInput): Promise<WebhookDispatchResult>;
}
