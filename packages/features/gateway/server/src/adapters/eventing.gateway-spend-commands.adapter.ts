import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  type AdmitSpendCommandData,
  admitSpendCommandDataSchema,
  type ConfirmSpendCommandData,
  confirmSpendCommandDataSchema,
  type FailSpendCommandData,
  failSpendCommandDataSchema,
  type SettleSpendCommandData,
  settleSpendCommandDataSchema,
} from "../processes/gateway-spend-commands.process";
import {
  ADMIT_SPEND_COMMAND_TYPE,
  CONFIRM_SPEND_COMMAND_TYPE,
  FAIL_SPEND_COMMAND_TYPE,
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_EVENT_VERSION_LATEST,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
  SETTLE_SPEND_COMMAND_TYPE,
} from "./gateway-spend-constants.adapter";
import type {
  GatewaySpendAdmittedEvent,
  GatewaySpendConfirmedEvent,
  GatewaySpendFailedEvent,
  GatewaySpendSettledEvent,
} from "./gateway-spend-events.adapter";

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

  async handle(
    command: Command<AdmitSpendCommandData>,
  ): Promise<GatewaySpendAdmittedEvent[]> {
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

  async handle(
    command: Command<ConfirmSpendCommandData>,
  ): Promise<GatewaySpendConfirmedEvent[]> {
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

  async handle(
    command: Command<FailSpendCommandData>,
  ): Promise<GatewaySpendFailedEvent[]> {
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

  async handle(
    command: Command<SettleSpendCommandData>,
  ): Promise<GatewaySpendSettledEvent[]> {
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
