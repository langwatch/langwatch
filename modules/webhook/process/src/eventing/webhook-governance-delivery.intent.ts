import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import type { GatewayGovernanceEvent } from "@langwatch/gateway-contract";
import {
  REQUEST_GOVERNANCE_DELIVERY_COMMAND_TYPE,
  WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_TYPE,
  WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_VERSION,
  WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE,
  webhookGovernanceDeliveryRequestSchema,
} from "@langwatch/webhook-contract";
import { z } from "zod";

import type { WebhookSpendDeliveryRequestedEvent } from "./webhook-spend-delivery.intent.ts";

const requestGovernanceDeliveryCommandDataSchema = z.object({
  ...webhookGovernanceDeliveryRequestSchema.shape,
  tenantId: z.string().min(1),
});
type RequestGovernanceDeliveryCommandData = z.infer<
  typeof requestGovernanceDeliveryCommandDataSchema
>;

export const webhookGovernanceDeliveryRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_TYPE),
  version: z.literal(WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_VERSION),
  data: requestGovernanceDeliveryCommandDataSchema,
});
type WebhookGovernanceDeliveryRequestedEvent = z.infer<
  typeof webhookGovernanceDeliveryRequestedEventSchema
>;

/** Every event webhook_delivery carries; both delivery managers read its stream. */
export type WebhookDeliveryEvent =
  | WebhookSpendDeliveryRequestedEvent
  | WebhookGovernanceDeliveryRequestedEvent;

/** The governed subject, as main's governance aggregates named it. */
function governedSubject(governance: GatewayGovernanceEvent): string {
  return governance.type === "lw.governance.budget_crossing"
    ? `budget:${governance.data.budget_id}`
    : `vk:${governance.data.virtual_key_id}`;
}

/**
 * One governance fact handed over for delivery. The source event id is gateway's own
 * idempotency key (a crossing's is its budget, bucket, kind and period), so a repeat
 * is dropped here and a crossing is delivered once per period.
 */
export class RequestGovernanceDeliveryCommand implements CommandHandler<
  Command<RequestGovernanceDeliveryCommandData>,
  WebhookGovernanceDeliveryRequestedEvent
> {
  static readonly schema = defineCommandSchema(
    REQUEST_GOVERNANCE_DELIVERY_COMMAND_TYPE,
    requestGovernanceDeliveryCommandDataSchema,
    "Queue one gateway governance fact for webhook delivery",
  );

  async handle(
    command: Command<RequestGovernanceDeliveryCommandData>,
  ): Promise<WebhookGovernanceDeliveryRequestedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<WebhookGovernanceDeliveryRequestedEvent>({
        aggregateType: WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE,
        aggregateId: governedSubject(data.governance),
        tenantId: createTenantId(command.tenantId),
        type: WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_TYPE,
        version: WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.governance.data.occurred_at,
        idempotencyKey: data.sourceEventId,
      }),
    ];
  }

  static getAggregateId(payload: RequestGovernanceDeliveryCommandData): string {
    return governedSubject(payload.governance);
  }
}
