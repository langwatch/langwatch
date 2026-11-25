import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
  GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type RecordBudgetCrossingCommandData,
  recordBudgetCrossingCommandDataSchema,
  type RecordUnbudgetedSpendCommandData,
  recordUnbudgetedSpendCommandDataSchema,
  unbudgetedSpendKeyOf,
  type RecordVkFirstRequestCommandData,
  recordVkFirstRequestCommandDataSchema,
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
const GATEWAY_GOVERNANCE_EVENTS_VERSION = "2026-07-31" as const;
const RECORD_VK_LIFECYCLE_COMMAND_TYPE = "lw.governance.record_vk_lifecycle" as const;
const RECORD_BUDGET_CROSSING_COMMAND_TYPE = "lw.governance.record_budget_crossing" as const;
const RECORD_VK_FIRST_REQUEST_COMMAND_TYPE = "lw.governance.record_vk_first_request" as const;
const RECORD_UNBUDGETED_SPEND_COMMAND_TYPE = "lw.governance.record_unbudgeted_spend" as const;

const eventEnvelope = z.object({
  ...EventSchema.shape,
  version: z.literal(GATEWAY_GOVERNANCE_EVENTS_VERSION),
});

export const gatewayVkLifecycleEventSchema = z.object({
  ...eventEnvelope.shape,
  type: z.literal(GATEWAY_VK_LIFECYCLE_EVENT_TYPE),
  data: recordVkLifecycleCommandDataSchema,
});
type GatewayVkLifecycleEvent = z.infer<typeof gatewayVkLifecycleEventSchema>;

export const gatewayBudgetCrossingEventSchema = z.object({
  ...eventEnvelope.shape,
  type: z.literal(GATEWAY_BUDGET_CROSSING_EVENT_TYPE),
  data: recordBudgetCrossingCommandDataSchema,
});
type GatewayBudgetCrossingEvent = z.infer<typeof gatewayBudgetCrossingEventSchema>;

export const gatewayVkFirstRequestEventSchema = z.object({
  ...eventEnvelope.shape,
  type: z.literal(GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE),
  data: recordVkFirstRequestCommandDataSchema,
});
type GatewayVkFirstRequestEvent = z.infer<typeof gatewayVkFirstRequestEventSchema>;

export const gatewayUnbudgetedSpendEventSchema = z.object({
  ...eventEnvelope.shape,
  type: z.literal(GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE),
  data: recordUnbudgetedSpendCommandDataSchema,
});
type GatewayUnbudgetedSpendEvent = z.infer<typeof gatewayUnbudgetedSpendEventSchema>;

export type GatewayGovernanceProcessingEvent =
  | GatewayVkLifecycleEvent
  | GatewayBudgetCrossingEvent
  | GatewayVkFirstRequestEvent
  | GatewayUnbudgetedSpendEvent;

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

/**
 * Keyed on the key alone, with no instant: that key IS the once-per-key rule, so two drain
 * batches that both read an empty `lastUsedAt` record the first request once.
 */
export class RecordVkFirstRequestCommand implements CommandHandler<
  Command<RecordVkFirstRequestCommandData>,
  GatewayVkFirstRequestEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_VK_FIRST_REQUEST_COMMAND_TYPE,
    recordVkFirstRequestCommandDataSchema,
    "Record a virtual key's first admitted request",
  );

  static getAggregateId(payload: RecordVkFirstRequestCommandData): string {
    return `vk:${payload.virtual_key_id}`;
  }

  async handle(
    command: Command<RecordVkFirstRequestCommandData>,
  ): Promise<GatewayVkFirstRequestEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewayVkFirstRequestEvent>({
        aggregateType: GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE,
        aggregateId: `vk:${data.virtual_key_id}`,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
        version: GATEWAY_GOVERNANCE_EVENTS_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: `${command.tenantId}:vk_first_request:${data.virtual_key_id}`,
      }),
    ];
  }
}

/**
 * Keyed on (organization, ISO week), with no instant. Every sweep of the week that finds the
 * organization still unbudgeted appends a fact under that one key: the log collapses repeats
 * only later, so nurturing's claim and the Customer.io message id stop a second send.
 */
export class RecordUnbudgetedSpendCommand implements CommandHandler<
  Command<RecordUnbudgetedSpendCommandData>,
  GatewayUnbudgetedSpendEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_UNBUDGETED_SPEND_COMMAND_TYPE,
    recordUnbudgetedSpendCommandDataSchema,
    "Record an organization's weekly spend on keys no budget applies to",
  );

  static getAggregateId(payload: RecordUnbudgetedSpendCommandData): string {
    return `org:${payload.organization_id}`;
  }

  async handle(
    command: Command<RecordUnbudgetedSpendCommandData>,
  ): Promise<GatewayUnbudgetedSpendEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GatewayUnbudgetedSpendEvent>({
        aggregateType: GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE,
        aggregateId: `org:${data.organization_id}`,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
        version: GATEWAY_GOVERNANCE_EVENTS_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: unbudgetedSpendKeyOf(data),
      }),
    ];
  }
}
