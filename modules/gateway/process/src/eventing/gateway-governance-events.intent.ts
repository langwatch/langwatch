import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type RecordBudgetCrossingCommandData,
  recordBudgetCrossingCommandDataSchema,
  type RecordVkLifecycleCommandData,
  recordVkLifecycleCommandDataSchema,
} from "@langwatch/gateway-contract";
import { z } from "zod";

/**
 * Main's stored names, kept as they were when governance owned this pipeline:
 * the event store's rows and idempotency keys carry over unchanged.
 */
export const GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME = "governance_events_processing" as const;
export const GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE = "governance_subject" as const;
export const GATEWAY_GOVERNANCE_EVENTS_VERSION = "2026-07-31" as const;
export const RECORD_VK_LIFECYCLE_COMMAND_TYPE = "lw.governance.record_vk_lifecycle" as const;
export const RECORD_BUDGET_CROSSING_COMMAND_TYPE = "lw.governance.record_budget_crossing" as const;

const eventEnvelope = z.object({
  ...EventSchema.shape,
  version: z.literal(GATEWAY_GOVERNANCE_EVENTS_VERSION),
});

export const gatewayVkLifecycleEventSchema = z.object({
  ...eventEnvelope.shape,
  type: z.literal(GATEWAY_VK_LIFECYCLE_EVENT_TYPE),
  data: recordVkLifecycleCommandDataSchema,
});
export type GatewayVkLifecycleEvent = z.infer<typeof gatewayVkLifecycleEventSchema>;

export const gatewayBudgetCrossingEventSchema = z.object({
  ...eventEnvelope.shape,
  type: z.literal(GATEWAY_BUDGET_CROSSING_EVENT_TYPE),
  data: recordBudgetCrossingCommandDataSchema,
});
export type GatewayBudgetCrossingEvent = z.infer<typeof gatewayBudgetCrossingEventSchema>;

export type GatewayGovernanceProcessingEvent = GatewayVkLifecycleEvent | GatewayBudgetCrossingEvent;

/** Keyed on (subject, action, instant), so an admin's double-click records once. */
export class RecordVkLifecycleCommand implements CommandHandler<
  Command<RecordVkLifecycleCommandData>,
  GatewayVkLifecycleEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_VK_LIFECYCLE_COMMAND_TYPE,
    recordVkLifecycleCommandDataSchema,
    "Record a virtual key lifecycle change for webhook delivery",
  );

  static getAggregateId(payload: RecordVkLifecycleCommandData): string {
    return `vk:${payload.virtual_key_id}`;
  }

  async handle(command: Command<RecordVkLifecycleCommandData>): Promise<GatewayVkLifecycleEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewayVkLifecycleEvent>({
        aggregateType: GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE,
        aggregateId: `vk:${data.virtual_key_id}`,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
        version: GATEWAY_GOVERNANCE_EVENTS_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: `${command.tenantId}:vk:${data.virtual_key_id}:${data.action}:${data.occurred_at}`,
      }),
    ];
  }
}

/**
 * Keyed on (budget, bucket, kind, period): that key IS the once-per-crossing-per-period
 * rule, so concurrent debits that both see the crossing record it once.
 */
export class RecordBudgetCrossingCommand implements CommandHandler<
  Command<RecordBudgetCrossingCommandData>,
  GatewayBudgetCrossingEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_BUDGET_CROSSING_COMMAND_TYPE,
    recordBudgetCrossingCommandDataSchema,
    "Record a budget threshold or breach crossing for webhook delivery",
  );

  static getAggregateId(payload: RecordBudgetCrossingCommandData): string {
    return `budget:${payload.budget_id}`;
  }

  async handle(
    command: Command<RecordBudgetCrossingCommandData>,
  ): Promise<GatewayBudgetCrossingEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewayBudgetCrossingEvent>({
        aggregateType: GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE,
        aggregateId: `budget:${data.budget_id}`,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
        version: GATEWAY_GOVERNANCE_EVENTS_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: `${command.tenantId}:budget:${data.budget_id}:${data.bucket_scope_id}:${data.kind}:${data.period_started_at_ms}`,
      }),
    ];
  }
}
