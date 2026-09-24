import type { SubscriberSpec } from "@langwatch/eventing";
import type { WebhookApi, WebhookSpendEvent } from "@langwatch/webhook-contract";

import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "./gateway-spend-commands.process.ts";
import type { GatewaySpendProcessingEvent } from "./gateway-spend.intent.ts";

export const GATEWAY_SPEND_WEBHOOK_SUBSCRIBER_NAME = "webhookSpendDelivery" as const;

/** The committed spend step as webhook delivery takes it. */
function webhookSpendEvent(event: GatewaySpendProcessingEvent): WebhookSpendEvent {
  switch (event.type) {
    case GATEWAY_SPEND_ADMITTED_EVENT_TYPE:
      return { type: event.type, data: event.data };
    case GATEWAY_SPEND_CONFIRMED_EVENT_TYPE:
      return { type: event.type, data: event.data };
    case GATEWAY_SPEND_FAILED_EVENT_TYPE:
      return { type: event.type, data: event.data };
    case GATEWAY_SPEND_SETTLED_EVENT_TYPE:
      return { type: event.type, data: event.data };
  }
}

/**
 * Hands every committed spend step to webhook delivery, named by the event's own
 * idempotency key, so a redelivery here is dropped by webhook's pipeline.
 */
export function gatewaySpendWebhookSubscriber(
  webhooks: Pick<WebhookApi, "requestSpendDelivery">,
): SubscriberSpec<GatewaySpendProcessingEvent> & { fold?: never; map?: never } {
  return {
    events: [
      GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
      GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      GATEWAY_SPEND_FAILED_EVENT_TYPE,
      GATEWAY_SPEND_SETTLED_EVENT_TYPE,
    ],
    handler: (event) =>
      webhooks.requestSpendDelivery({
        sourceEventId: event.idempotencyKey ?? event.id,
        spend: webhookSpendEvent(event),
      }),
  };
}
