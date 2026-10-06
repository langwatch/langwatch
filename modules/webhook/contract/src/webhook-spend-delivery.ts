/**
 * The gateway spend events webhook delivery consumes, as the delivery
 * pipeline's one command carries them: webhook's peer subscribers read these
 * off gateway_spend_processing (the schemas are gateway's contract events).
 */
import { gatewaySpendEventSchema } from "@langwatch/gateway-contract";
import { z } from "zod";

export const WEBHOOK_DELIVERY_PIPELINE_NAME = "webhook_delivery" as const;
export const WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE = "webhook_spend_delivery" as const;
export const WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE =
  "lw.webhook.spend_delivery.requested" as const;
export const WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_VERSION = "2026-09-25" as const;
export const REQUEST_SPEND_DELIVERY_COMMAND_TYPE = "lw.webhook.request_spend_delivery" as const;

/** One committed gateway spend event as webhook delivery takes it, named by its event id. */
export const webhookSpendDeliveryRequestSchema = z.object({
  sourceEventId: z.string().min(1),
  spend: gatewaySpendEventSchema,
});
export type WebhookSpendDeliveryRequest = z.infer<typeof webhookSpendDeliveryRequestSchema>;
