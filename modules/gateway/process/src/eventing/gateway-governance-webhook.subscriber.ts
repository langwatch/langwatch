import type { SubscriberSpec } from "@langwatch/eventing";
import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type GatewayGovernanceEvent,
} from "@langwatch/gateway-contract";
import type { WebhookApi } from "@langwatch/webhook-contract";

import type { GatewayGovernanceProcessingEvent } from "./gateway-governance-events.intent.ts";

export const GATEWAY_GOVERNANCE_WEBHOOK_SUBSCRIBER_NAME = "webhookGovernanceDelivery" as const;

function governanceEvent(event: GatewayGovernanceProcessingEvent): GatewayGovernanceEvent {
  switch (event.type) {
    case GATEWAY_BUDGET_CROSSING_EVENT_TYPE:
      return { type: event.type, data: event.data };
    case GATEWAY_VK_LIFECYCLE_EVENT_TYPE:
      return { type: event.type, data: event.data };
  }
}

/**
 * Hands every recorded governance fact to webhook delivery, named by the event's own
 * idempotency key, so a redelivery here is dropped by webhook's pipeline.
 */
export function gatewayGovernanceWebhookSubscriber(
  webhooks: Pick<WebhookApi, "requestGatewayEventDelivery">,
): SubscriberSpec<GatewayGovernanceProcessingEvent> & { fold?: never; map?: never } {
  return {
    events: [GATEWAY_BUDGET_CROSSING_EVENT_TYPE, GATEWAY_VK_LIFECYCLE_EVENT_TYPE],
    handler: (event) =>
      webhooks.requestGatewayEventDelivery({
        sourceEventId: event.idempotencyKey ?? event.id,
        governance: governanceEvent(event),
      }),
  };
}
