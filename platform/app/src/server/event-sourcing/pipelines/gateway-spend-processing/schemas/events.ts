import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";
import {
  admitSpendCommandDataSchema,
  confirmSpendCommandDataSchema,
  failSpendCommandDataSchema,
  settleSpendCommandDataSchema,
} from "./commands";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "./constants";

/**
 * The four events of a gateway request's spend lifecycle. Event data is the
 * command data verbatim: commands validate the wire, events are the durable
 * record, and the fold applies with absolute writes only.
 *
 * `settled` is emitted by the settlement process manager (M2) when an
 * admitted request's confirmation never arrived; the fold handles it from
 * day one so replay order never meets an unknown type.
 */
export const gatewaySpendAdmittedEventSchema = EventSchema.extend({
  type: z.literal(GATEWAY_SPEND_ADMITTED_EVENT_TYPE),
  data: admitSpendCommandDataSchema,
});
export type GatewaySpendAdmittedEvent = z.infer<
  typeof gatewaySpendAdmittedEventSchema
>;

export const gatewaySpendConfirmedEventSchema = EventSchema.extend({
  type: z.literal(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE),
  data: confirmSpendCommandDataSchema,
});
export type GatewaySpendConfirmedEvent = z.infer<
  typeof gatewaySpendConfirmedEventSchema
>;

export const gatewaySpendFailedEventSchema = EventSchema.extend({
  type: z.literal(GATEWAY_SPEND_FAILED_EVENT_TYPE),
  data: failSpendCommandDataSchema,
});
export type GatewaySpendFailedEvent = z.infer<
  typeof gatewaySpendFailedEventSchema
>;

export const gatewaySpendSettledEventSchema = EventSchema.extend({
  type: z.literal(GATEWAY_SPEND_SETTLED_EVENT_TYPE),
  data: settleSpendCommandDataSchema,
});
export type GatewaySpendSettledEvent = z.infer<
  typeof gatewaySpendSettledEventSchema
>;

export type GatewaySpendProcessingEvent =
  | GatewaySpendAdmittedEvent
  | GatewaySpendConfirmedEvent
  | GatewaySpendFailedEvent
  | GatewaySpendSettledEvent;
