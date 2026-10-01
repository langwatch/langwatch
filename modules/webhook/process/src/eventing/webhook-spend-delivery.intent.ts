import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import {
  REQUEST_SPEND_DELIVERY_COMMAND_TYPE,
  WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE,
  WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE,
  WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_VERSION,
  webhookSpendDeliveryRequestSchema,
} from "@langwatch/webhook-contract";
import { z } from "zod";

export const requestSpendDeliveryCommandDataSchema = z.object({
  ...webhookSpendDeliveryRequestSchema.shape,
  tenantId: z.string().min(1),
});
export type RequestSpendDeliveryCommandData = z.infer<typeof requestSpendDeliveryCommandDataSchema>;

export const webhookSpendDeliveryRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE),
  version: z.literal(WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_VERSION),
  data: requestSpendDeliveryCommandDataSchema,
});
export type WebhookSpendDeliveryRequestedEvent = z.infer<
  typeof webhookSpendDeliveryRequestedEventSchema
>;

/**
 * One spend event handed over for delivery. The aggregate is the gateway request, so its
 * admission and outcome meet in one process instance; the source event id is the
 * idempotency key, so a repeat is dropped and the inbox reads the id main's rows carry.
 */
export class RequestSpendDeliveryCommand implements CommandHandler<
  Command<RequestSpendDeliveryCommandData>,
  WebhookSpendDeliveryRequestedEvent
> {
  static readonly schema = defineCommandSchema(
    REQUEST_SPEND_DELIVERY_COMMAND_TYPE,
    requestSpendDeliveryCommandDataSchema,
    "Queue one committed gateway spend event for webhook delivery",
  );

  async handle(
    command: Command<RequestSpendDeliveryCommandData>,
  ): Promise<WebhookSpendDeliveryRequestedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<WebhookSpendDeliveryRequestedEvent>({
        aggregateType: WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE,
        aggregateId: data.spend.data.gateway_request_id,
        tenantId: createTenantId(command.tenantId),
        type: WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE,
        version: WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.spend.data.occurred_at,
        idempotencyKey: data.sourceEventId,
      }),
    ];
  }

  static getAggregateId(payload: RequestSpendDeliveryCommandData): string {
    return payload.spend.data.gateway_request_id;
  }

  static getSpanAttributes(
    payload: RequestSpendDeliveryCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.webhook_delivery.source_event_id": payload.sourceEventId,
      "payload.webhook_delivery.spend_type": payload.spend.type,
    };
  }
}
