/**
 * The gateway governance facts webhook delivers, taken from gateway's contract:
 * a budget crossing and a virtual key lifecycle change. Needs
 * "@langwatch/gateway-contract" declared and installed in this package first.
 */
import { gatewayGovernanceEventSchema } from "@langwatch/gateway-contract";
import { z } from "zod";

import { webhookSpendDeliveryRequestSchema } from "./webhook-spend-delivery.ts";

export const WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_TYPE =
  "lw.webhook.governance_delivery.requested" as const;
export const WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_VERSION = "2026-09-29" as const;
export const REQUEST_GOVERNANCE_DELIVERY_COMMAND_TYPE =
  "lw.webhook.request_governance_delivery" as const;

export const webhookGovernanceDeliveryRequestSchema = z.object({
  sourceEventId: z.string().min(1),
  governance: gatewayGovernanceEventSchema,
});
export type WebhookGovernanceDeliveryRequest = z.infer<
  typeof webhookGovernanceDeliveryRequestSchema
>;

/** What gateway hands over: one committed gateway event, named by its idempotency key. */
export const webhookGatewayEventDeliveryRequestSchema = z.union([
  webhookSpendDeliveryRequestSchema,
  webhookGovernanceDeliveryRequestSchema,
]);
export type WebhookGatewayEventDeliveryRequest = z.infer<
  typeof webhookGatewayEventDeliveryRequestSchema
>;
