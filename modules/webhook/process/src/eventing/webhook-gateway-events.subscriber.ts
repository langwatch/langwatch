import type { PeerSubscriberContext, PeerSubscriberDefinition } from "@langwatch/eventing";
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
type WebhookGatewayEventSubscribers = Readonly<{
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

/** A fact's delivery identity: its idempotency key when it has one, as gateway's lanes keyed it. */
function sourceEventId({ idempotencyKey, eventId }: PeerSubscriberContext): string {
  return idempotencyKey ?? eventId;
}

/**
 * Webhook's peer subscribers on gateway's spend and governance facts (record §5, §9): each
 * committed fact is queued for delivery under its source id, so a redelivered or re-appended
 * fact collapses on webhook_delivery's idempotency key and delivers once.
 */
export function webhookGatewayEventSubscribers(
  deliver: WebhookGatewayEventDelivery,
): WebhookGatewayEventSubscribers {
  return {
    gatewaySpendAdmittedDelivery: {
      eventType: GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
      data: gatewaySpendAdmittedEventDataSchema,
      handle: (data, context) =>
        deliver({
          sourceEventId: sourceEventId(context),
          spend: { type: GATEWAY_SPEND_ADMITTED_EVENT_TYPE, data },
        }),
    },
    gatewaySpendConfirmedDelivery: {
      eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
      data: gatewaySpendConfirmedEventDataSchema,
      handle: (data, context) =>
        deliver({
          sourceEventId: sourceEventId(context),
          spend: { type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE, data },
        }),
    },
    gatewaySpendFailedDelivery: {
      eventType: GATEWAY_SPEND_FAILED_EVENT_TYPE,
      data: gatewaySpendFailedEventDataSchema,
      handle: (data, context) =>
        deliver({
          sourceEventId: sourceEventId(context),
          spend: { type: GATEWAY_SPEND_FAILED_EVENT_TYPE, data },
        }),
    },
    gatewaySpendSettledDelivery: {
      eventType: GATEWAY_SPEND_SETTLED_EVENT_TYPE,
      data: gatewaySpendSettledEventDataSchema,
      handle: (data, context) =>
        deliver({
          sourceEventId: sourceEventId(context),
          spend: { type: GATEWAY_SPEND_SETTLED_EVENT_TYPE, data },
        }),
    },
    gatewayBudgetCrossingDelivery: {
      eventType: GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
      data: recordBudgetCrossingCommandDataSchema,
      handle: (data, context) =>
        deliver({
          sourceEventId: sourceEventId(context),
          governance: { type: GATEWAY_BUDGET_CROSSING_EVENT_TYPE, data },
        }),
    },
    gatewayVkLifecycleDelivery: {
      eventType: GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
      data: recordVkLifecycleCommandDataSchema,
      handle: (data, context) =>
        deliver({
          sourceEventId: sourceEventId(context),
          governance: { type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE, data },
        }),
    },
  };
}
