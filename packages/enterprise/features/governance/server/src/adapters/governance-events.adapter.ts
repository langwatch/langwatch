// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GOVERNANCE_EVENTS_AGGREGATE_TYPE,
  GOVERNANCE_EVENTS_EVENT_TYPES,
  GOVERNANCE_EVENTS_EVENT_VERSION_LATEST,
  GOVERNANCE_EVENTS_PIPELINE_NAME,
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
  RECORD_BUDGET_CROSSING_COMMAND_TYPE,
  RECORD_VK_LIFECYCLE_COMMAND_TYPE,
  type RecordBudgetCrossingCommandData,
  type RecordVkLifecycleCommandData,
  recordBudgetCrossingCommandDataSchema,
  recordVkLifecycleCommandDataSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  createTenantId,
  defineAggregate,
  defineCommandSchema,
  defineEvents,
  definePipeline,
  EventUtils,
  type Command,
  type CommandHandler,
} from "@langwatch/eventing";
import {
  GOVERNANCE_EVENTS_PROCESS_NAME,
  GovernanceEventDeliveryProcess,
} from "../processes/governance-event-delivery.process";
import type { GovernanceEventsProcessingEvent } from "../ports/governance-webhook.port";

type GovernanceVkLifecycleEvent = Extract<
  GovernanceEventsProcessingEvent,
  { type: typeof GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE }
>;
type GovernanceBudgetCrossingEvent = Extract<
  GovernanceEventsProcessingEvent,
  { type: typeof GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE }
>;

export interface GovernanceEventsPipelineDeps {
  /** Absent means append-only; a later replay can still deliver the facts. */
  webhookDelivery?: GovernanceEventDeliveryProcess;
}

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

/** Ordered per governed subject; durable command keys enforce idempotency. */
export function createGovernanceEventsPipeline(deps: GovernanceEventsPipelineDeps) {
  let pipeline = definePipeline<GovernanceEventsProcessingEvent>({
    name: GOVERNANCE_EVENTS_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: GOVERNANCE_EVENTS_AGGREGATE_TYPE,
      events: defineEvents(GOVERNANCE_EVENTS_EVENT_TYPES),
    }),
  })
    .withCommand("recordVkLifecycle", RecordVkLifecycleCommand)
    .withCommand("recordBudgetCrossing", RecordBudgetCrossingCommand);
  if (deps.webhookDelivery) {
    pipeline = pipeline.withProcessManager(
      GOVERNANCE_EVENTS_PROCESS_NAME,
      deps.webhookDelivery.processManager(),
    );
  }
  return pipeline.build();
}
