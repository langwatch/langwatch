import { z } from "zod";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "./gateway-spend-constants.adapter";
import {
  admitSpendCommandDataSchema,
  confirmSpendCommandDataSchema,
  failSpendCommandDataSchema,
  settleSpendCommandDataSchema,
} from "../processes/gateway-spend-commands.process";

const eventEnvelope = z.object({
  aggregateId: z.string(),
  aggregateType: z.string(),
  data: z.unknown(),
  id: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: z.coerce.date(),
  tenantId: z.string(),
  type: z.string(),
  version: z.string(),
});

export const gatewaySpendAdmittedEventSchema = eventEnvelope.extend({
  type: z.literal(GATEWAY_SPEND_ADMITTED_EVENT_TYPE),
  data: admitSpendCommandDataSchema,
});
export type GatewaySpendAdmittedEvent = z.infer<typeof gatewaySpendAdmittedEventSchema>;

export const gatewaySpendConfirmedEventSchema = eventEnvelope.extend({
  type: z.literal(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE),
  data: confirmSpendCommandDataSchema,
});
export type GatewaySpendConfirmedEvent = z.infer<typeof gatewaySpendConfirmedEventSchema>;

export const gatewaySpendFailedEventSchema = eventEnvelope.extend({
  type: z.literal(GATEWAY_SPEND_FAILED_EVENT_TYPE),
  data: failSpendCommandDataSchema,
});
export type GatewaySpendFailedEvent = z.infer<typeof gatewaySpendFailedEventSchema>;

export const gatewaySpendSettledEventSchema = eventEnvelope.extend({
  type: z.literal(GATEWAY_SPEND_SETTLED_EVENT_TYPE),
  data: settleSpendCommandDataSchema,
});
export type GatewaySpendSettledEvent = z.infer<typeof gatewaySpendSettledEventSchema>;
