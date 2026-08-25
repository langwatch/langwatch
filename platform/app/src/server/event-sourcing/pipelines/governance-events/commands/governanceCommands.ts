import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  type RecordBudgetCrossingCommandData,
  type RecordVkLifecycleCommandData,
  recordBudgetCrossingCommandDataSchema,
  recordVkLifecycleCommandDataSchema,
} from "../schemas/commands";
import {
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_EVENTS_AGGREGATE_TYPE,
  GOVERNANCE_EVENTS_EVENT_VERSION_LATEST,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
  RECORD_BUDGET_CROSSING_COMMAND_TYPE,
  RECORD_VK_LIFECYCLE_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  GovernanceBudgetCrossingEvent,
  GovernanceVkLifecycleEvent,
} from "../schemas/events";

/**
 * Pure appends. Aggregates are the governed subject itself ("vk:<id>" or
 * "budget:<id>"), so per-subject FIFO gives the delivery process manager
 * ordered lifecycle streams and a per-budget place to keep crossing
 * dedup state.
 *
 * Idempotency: lifecycle appends key on (subject, action, occurred_at) so
 * an admin double-click cannot double-emit; crossing appends key on
 * (budget, bucket, kind, period), which IS the once-per-crossing-per-period
 * rule at the store, with the process manager's state as the second lock.
 */

export class RecordVkLifecycleCommand implements CommandHandler<
  Command<RecordVkLifecycleCommandData>,
  GovernanceVkLifecycleEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_VK_LIFECYCLE_COMMAND_TYPE,
    recordVkLifecycleCommandDataSchema,
    "Record a virtual key lifecycle change for webhook delivery",
  );

  static getAggregateId(payload: RecordVkLifecycleCommandData): string {
    return `vk:${payload.virtual_key_id}`;
  }

  async handle(
    command: Command<RecordVkLifecycleCommandData>,
  ): Promise<GovernanceVkLifecycleEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GovernanceVkLifecycleEvent>({
        aggregateType: GOVERNANCE_EVENTS_AGGREGATE_TYPE,
        aggregateId: `vk:${data.virtual_key_id}`,
        tenantId: createTenantId(command.tenantId),
        type: GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
        version: GOVERNANCE_EVENTS_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: `${command.tenantId}:vk:${data.virtual_key_id}:${data.action}:${data.occurred_at}`,
      }),
    ];
  }
}

export class RecordBudgetCrossingCommand implements CommandHandler<
  Command<RecordBudgetCrossingCommandData>,
  GovernanceBudgetCrossingEvent
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
  ): Promise<GovernanceBudgetCrossingEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<GovernanceBudgetCrossingEvent>({
        aggregateType: GOVERNANCE_EVENTS_AGGREGATE_TYPE,
        aggregateId: `budget:${data.budget_id}`,
        tenantId: createTenantId(command.tenantId),
        type: GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
        version: GOVERNANCE_EVENTS_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurred_at,
        idempotencyKey: `${command.tenantId}:budget:${data.budget_id}:${data.bucket_scope_id}:${data.kind}:${data.period_started_at_ms}`,
      }),
    ];
  }
}
