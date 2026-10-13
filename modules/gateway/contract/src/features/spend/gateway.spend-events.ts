import type { Named } from "@langwatch/module";
/**
 * Gateway's spend facts: one event per committed lifecycle step of a gateway request.
 * Gateway records each on gateway_spend_processing; a delivery module subscribes to them.
 * The stored type names and field names are main's, so stored rows and envelopes carry over.
 */
import { z } from "zod";

import { spendUsageSchema } from "./gateway-spend.schemas.ts";

export const GATEWAY_SPEND_ADMITTED_EVENT_TYPE = "lw.gateway.spend.admitted" as const;
export const GATEWAY_SPEND_CONFIRMED_EVENT_TYPE = "lw.gateway.spend.confirmed" as const;
export const GATEWAY_SPEND_FAILED_EVENT_TYPE = "lw.gateway.spend.failed" as const;
export const GATEWAY_SPEND_SETTLED_EVENT_TYPE = "lw.gateway.spend.settled" as const;

const count = z.number().int().min(0).default(0);

const spendAttributionSchema = z.object({
  organization_id: z.string().default(""),
  virtual_key_id: z.string().default(""),
  principal_user_id: z.string().default(""),
  end_user_id: z.string().default(""),
  model: z.string().default(""),
  model_provider_id: z.string().default(""),
  trace_id: z.string().default(""),
  request_type: z.string().default(""),
  labels: z.array(z.string()).default([]),
  metadata: z.string().default(""),
});

const spendStepSchema = z.object({
  gateway_request_id: z.string().min(1),
  occurred_at: z.number().int().min(0),
  tenantId: z.string().min(1),
});

const spendOutcomeSchema = z.object({
  ...spendAttributionSchema.shape,
  ...spendStepSchema.shape,
  admitted_at: count,
  usage: spendUsageSchema,
  cost_nano_usd: count,
  rate_version: z.string().default(""),
  duration_ms: count,
});

const gatewaySpendAdmittedEventDataSchemaDefinition = z.object({
  ...spendAttributionSchema.shape,
  ...spendStepSchema.shape,
  outcome_carries_attribution: z.boolean().default(false),
});
export interface GatewaySpendAdmittedEventDataSchema extends Named<
  typeof gatewaySpendAdmittedEventDataSchemaDefinition
> {}
export const gatewaySpendAdmittedEventDataSchema: GatewaySpendAdmittedEventDataSchema =
  gatewaySpendAdmittedEventDataSchemaDefinition;
export const gatewaySpendConfirmedEventDataSchema = spendOutcomeSchema;
const gatewaySpendFailedEventDataSchemaDefinition = z.object({
  ...spendOutcomeSchema.shape,
  error: z.object({ type: z.string(), http_status: count }),
});
export interface GatewaySpendFailedEventDataSchema extends Named<
  typeof gatewaySpendFailedEventDataSchemaDefinition
> {}
export const gatewaySpendFailedEventDataSchema: GatewaySpendFailedEventDataSchema =
  gatewaySpendFailedEventDataSchemaDefinition;
const gatewaySpendSettledEventDataSchemaDefinition = z.object({
  ...spendAttributionSchema.shape,
  ...spendStepSchema.shape,
  admitted_at: count,
  reason: z.string(),
});
export interface GatewaySpendSettledEventDataSchema extends Named<
  typeof gatewaySpendSettledEventDataSchemaDefinition
> {}
export const gatewaySpendSettledEventDataSchema: GatewaySpendSettledEventDataSchema =
  gatewaySpendSettledEventDataSchemaDefinition;

/** One spend fact as a delivery module takes it, typed by the lifecycle step it records. */
const gatewaySpendEventSchemaDefinition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(GATEWAY_SPEND_ADMITTED_EVENT_TYPE),
    data: gatewaySpendAdmittedEventDataSchema,
  }),
  z.object({
    type: z.literal(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE),
    data: gatewaySpendConfirmedEventDataSchema,
  }),
  z.object({
    type: z.literal(GATEWAY_SPEND_FAILED_EVENT_TYPE),
    data: gatewaySpendFailedEventDataSchema,
  }),
  z.object({
    type: z.literal(GATEWAY_SPEND_SETTLED_EVENT_TYPE),
    data: gatewaySpendSettledEventDataSchema,
  }),
]);
export interface GatewaySpendEventSchema extends Named<typeof gatewaySpendEventSchemaDefinition> {}
export const gatewaySpendEventSchema: GatewaySpendEventSchema = gatewaySpendEventSchemaDefinition;
export type GatewaySpendEvent = z.infer<typeof gatewaySpendEventSchema>;
