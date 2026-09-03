import { EventSchema } from "@langwatch/eventing";
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
import { GATEWAY_SPEND_EVENT_VERSION_LATEST } from "./gateway-spend-constants.adapter";

/**
 * The envelope is the framework's, not this feature's.
 *
 * It was a hand-written `z.object` here, and it disagreed with
 * `@langwatch/eventing`'s in three ways that matter: no `createdAt`,
 * `occurredAt` as a `Date` rather than the epoch milliseconds the store
 * writes, and plain strings where the framework brands `tenantId`,
 * `aggregateType` and `type`. Every event type below therefore failed the
 * `Event` constraint the pipeline, the command handlers and the process
 * manager all declare — eight compile errors saying the same thing.
 */
const eventEnvelope = EventSchema.extend({
  version: z.literal(GATEWAY_SPEND_EVENT_VERSION_LATEST),
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

/**
 * Every event the spend pipeline folds and its process manager wakes on.
 *
 * Declared here because it is this module's own union; the pipeline, the
 * settlement process manager and the fold projection each named it and none
 * of them could resolve it.
 */
export type GatewaySpendProcessingEvent =
  | GatewaySpendAdmittedEvent
  | GatewaySpendConfirmedEvent
  | GatewaySpendFailedEvent
  | GatewaySpendSettledEvent;
