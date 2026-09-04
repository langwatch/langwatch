import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";
import {
  ADMIT_SPEND_COMMAND_TYPE,
  type AdmitSpendCommandData,
  admitSpendCommandDataSchema,
  CONFIRM_SPEND_COMMAND_TYPE,
  type ConfirmSpendCommandData,
  confirmSpendCommandDataSchema,
  FAIL_SPEND_COMMAND_TYPE,
  type FailSpendCommandData,
  failSpendCommandDataSchema,
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
  SETTLE_SPEND_COMMAND_TYPE,
  type SettleSpendCommandData,
  settleSpendCommandDataSchema,
} from "../processes/gateway-spend-commands.process";
/**
 * The four spend commands are pure appends: validate, stamp identity, emit
 * one event. The aggregate is the gateway request itself (ULID), so the id
 * exists before the provider is called and stays the idempotency key
 * everywhere: internal dedup here, the external webhook event_id, and
 * replay all key off it.
 *
 * Idempotency: one event per (tenant, request, lifecycle step). A
 * redelivered or double-posted command re-uses the same idempotency key and
 * the event store drops the duplicate, so at-least-once emission from the
 * gateway spool can never double a request, and a confirm retried after a
 * crash cannot double-rate it.
 */

function idempotencyKey({
  tenantId,
  gatewayRequestId,
  step,
}: {
  tenantId: string;
  gatewayRequestId: string;
  step: string;
}): string {
  return `${tenantId}:${gatewayRequestId}:${step}`;
}

export class AdmitSpendCommand implements CommandHandler<
  Command<AdmitSpendCommandData>,
  GatewaySpendAdmittedEvent
> {
  static readonly schema = defineCommandSchema(
    ADMIT_SPEND_COMMAND_TYPE,
    admitSpendCommandDataSchema,
    "Record a gateway request's admission, before any provider outcome",
  );

  async handle(command: Command<AdmitSpendCommandData>): Promise<GatewaySpendAdmittedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewaySpendAdmittedEvent>({
        aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
        aggregateId: data.gateway_request_id,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
        version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: idempotencyKey({
          tenantId: command.tenantId,
          gatewayRequestId: data.gateway_request_id,
          step: "admitted",
        }),
      }),
    ];
  }

  static getAggregateId(payload: AdmitSpendCommandData): string {
    return payload.gateway_request_id;
  }

  static getSpanAttributes(
    payload: AdmitSpendCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.gateway_spend.request_id": payload.gateway_request_id,
      "payload.gateway_spend.virtual_key_id": payload.virtual_key_id,
      "payload.gateway_spend.model": payload.model,
    };
  }
}

export class ConfirmSpendCommand implements CommandHandler<
  Command<ConfirmSpendCommandData>,
  GatewaySpendConfirmedEvent
> {
  static readonly schema = defineCommandSchema(
    CONFIRM_SPEND_COMMAND_TYPE,
    confirmSpendCommandDataSchema,
    "Record a gateway request's provider outcome with usage quantities",
  );

  async handle(command: Command<ConfirmSpendCommandData>): Promise<GatewaySpendConfirmedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewaySpendConfirmedEvent>({
        aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
        aggregateId: data.gateway_request_id,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: idempotencyKey({
          tenantId: command.tenantId,
          gatewayRequestId: data.gateway_request_id,
          step: "confirmed",
        }),
      }),
    ];
  }

  static getAggregateId(payload: ConfirmSpendCommandData): string {
    return payload.gateway_request_id;
  }

  static getSpanAttributes(
    payload: ConfirmSpendCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.gateway_spend.request_id": payload.gateway_request_id,
      "payload.gateway_spend.input_tokens": payload.usage.input_tokens,
      "payload.gateway_spend.output_tokens": payload.usage.output_tokens,
    };
  }
}

export class FailSpendCommand implements CommandHandler<
  Command<FailSpendCommandData>,
  GatewaySpendFailedEvent
> {
  static readonly schema = defineCommandSchema(
    FAIL_SPEND_COMMAND_TYPE,
    failSpendCommandDataSchema,
    "Record a gateway request's failure with its full error class",
  );

  async handle(command: Command<FailSpendCommandData>): Promise<GatewaySpendFailedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewaySpendFailedEvent>({
        aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
        aggregateId: data.gateway_request_id,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_SPEND_FAILED_EVENT_TYPE,
        version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: idempotencyKey({
          tenantId: command.tenantId,
          gatewayRequestId: data.gateway_request_id,
          step: "failed",
        }),
      }),
    ];
  }

  static getAggregateId(payload: FailSpendCommandData): string {
    return payload.gateway_request_id;
  }

  static getSpanAttributes(
    payload: FailSpendCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.gateway_spend.request_id": payload.gateway_request_id,
      "payload.gateway_spend.error_type": payload.error.type,
    };
  }
}

export class SettleSpendCommand implements CommandHandler<
  Command<SettleSpendCommandData>,
  GatewaySpendSettledEvent
> {
  static readonly schema = defineCommandSchema(
    SETTLE_SPEND_COMMAND_TYPE,
    settleSpendCommandDataSchema,
    "Settle an admitted request whose confirmation never arrived",
  );

  async handle(command: Command<SettleSpendCommandData>): Promise<GatewaySpendSettledEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewaySpendSettledEvent>({
        aggregateType: GATEWAY_SPEND_AGGREGATE_TYPE,
        aggregateId: data.gateway_request_id,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_SPEND_SETTLED_EVENT_TYPE,
        version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: idempotencyKey({
          tenantId: command.tenantId,
          gatewayRequestId: data.gateway_request_id,
          step: "settled",
        }),
      }),
    ];
  }

  static getAggregateId(payload: SettleSpendCommandData): string {
    return payload.gateway_request_id;
  }

  static getSpanAttributes(
    payload: SettleSpendCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.gateway_spend.request_id": payload.gateway_request_id,
      "payload.gateway_spend.settle_reason": payload.reason,
    };
  }
}

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
