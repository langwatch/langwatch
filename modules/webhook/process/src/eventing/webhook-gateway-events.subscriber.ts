import type { PeerSubscriberDefinition } from "@langwatch/eventing";
import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  gatewaySpendAdmittedEventDataSchema,
  gatewaySpendConfirmedEventDataSchema,
  gatewaySpendFailedEventDataSchema,
  gatewaySpendSettledEventDataSchema,
  recordBudgetCrossingCommandDataSchema,
  recordVkLifecycleCommandDataSchema,
} from "@langwatch/gateway-contract";
import type { WebhookGatewayEventDeliveryRequest } from "@langwatch/webhook-contract";

/** Queues one committed gateway event for delivery; a repeat of the same source id is dropped. */
export type WebhookGatewayEventDelivery = (
  request: WebhookGatewayEventDeliveryRequest,
) => Promise<void>;

/** One peer subscriber per gateway fact webhook delivers, each on that event's contract data. */
export type WebhookGatewayEventSubscribers = Readonly<{
  gatewaySpendAdmittedDelivery: PeerSubscriberDefinition<
    typeof gatewaySpendAdmittedEventDataSchema
  >;
  gatewaySpendConfirmedDelivery: PeerSubscriberDefinition<
    typeof gatewaySpendConfirmedEventDataSchema
  >;
  gatewaySpendFailedDelivery: PeerSubscriberDefinition<typeof gatewaySpendFailedEventDataSchema>;
  gatewaySpendSettledDelivery: PeerSubscriberDefinition<typeof gatewaySpendSettledEventDataSchema>;
  gatewayBudgetCrossingDelivery: PeerSubscriberDefinition<
    typeof recordBudgetCrossingCommandDataSchema
  >;
  gatewayVkLifecycleDelivery: PeerSubscriberDefinition<typeof recordVkLifecycleCommandDataSchema>;
}>;

/**
 * Webhook's peer subscribers on gateway's spend and governance facts (record §5, §9): each
 * committed event is queued for delivery under its own event id, so a redelivered event
 * collapses on webhook_delivery's idempotency key and delivers once.
 */
export function webhookGatewayEventSubscribers(
  deliver: WebhookGatewayEventDelivery,
): WebhookGatewayEventSubscribers {
  return {
    gatewaySpendAdmittedDelivery: {
      eventType: GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
      data: gatewaySpendAdmittedEventDataSchema,
      handle: (data, { eventId }) =>
        deliver({
          sourceEventId: eventId,
          spend: { type: GATEWAY_SPEND_ADMITTED_EVENT_TYPE, data },
        }),
    },
    gatewaySpendConfirmedDelivery: {
      eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      data: gatewaySpendConfirmedEventDataSchema,
      handle: (data, { eventId }) =>
        deliver({
          sourceEventId: eventId,
          spend: { type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, data },
        }),
    },
    gatewaySpendFailedDelivery: {
      eventType: GATEWAY_SPEND_FAILED_EVENT_TYPE,
      data: gatewaySpendFailedEventDataSchema,
      handle: (data, { eventId }) =>
        deliver({ sourceEventId: eventId, spend: { type: GATEWAY_SPEND_FAILED_EVENT_TYPE, data } }),
    },
    gatewaySpendSettledDelivery: {
      eventType: GATEWAY_SPEND_SETTLED_EVENT_TYPE,
      data: gatewaySpendSettledEventDataSchema,
      handle: (data, { eventId }) =>
        deliver({
          sourceEventId: eventId,
          spend: { type: GATEWAY_SPEND_SETTLED_EVENT_TYPE, data },
        }),
    },
    gatewayBudgetCrossingDelivery: {
      eventType: GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
      data: recordBudgetCrossingCommandDataSchema,
      handle: (data, { eventId }) =>
        deliver({
          sourceEventId: eventId,
          governance: { type: GATEWAY_BUDGET_CROSSING_EVENT_TYPE, data },
        }),
    },
    gatewayVkLifecycleDelivery: {
      eventType: GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
      data: recordVkLifecycleCommandDataSchema,
      handle: (data, { eventId }) =>
        deliver({
          sourceEventId: eventId,
          governance: { type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE, data },
        }),
    },
  };
}
