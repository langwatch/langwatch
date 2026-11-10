import {
  SCENARIO_RUN_GRACE_ENDED_EVENT_TYPE,
  SCENARIO_RUNS_COUNTED_EVENT_TYPE,
  SCENARIO_RUNS_THRESHOLD_REACHED_EVENT_TYPE,
  USAGE_LIMIT_CLEARED_EVENT_TYPE,
  USAGE_LIMIT_REACHED_EVENT_TYPE,
  USAGE_MONTH_COUNTED_EVENT_TYPE,
  USAGE_THRESHOLD_CROSSED_EVENT_TYPE,
} from "@langwatch/entitlement-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import type { ScenarioRunCapService } from "../services/scenario-run-cap.service.ts";
import type { UsageCountingService } from "../services/usage-counting.service.ts";
import {
  type CountScenarioRunsCommandData,
  countScenarioRunsCommandDataSchema,
  type RecordScenarioRunGraceEndedCommandData,
  recordScenarioRunGraceEndedCommandDataSchema,
  type RecordScenarioRunsThresholdCommandData,
  recordScenarioRunsThresholdCommandDataSchema,
  type CountMonthCommandData,
  countMonthCommandDataSchema,
  type RecordLimitDecisionCommandData,
  recordLimitDecisionCommandDataSchema,
  type RecordUsageWarningCommandData,
  recordUsageWarningCommandDataSchema,
  USAGE_AGGREGATE_TYPE,
  USAGE_EVENT_VERSION,
  type UsageEvent,
} from "./usage.events.ts";

/** Counts the organization's month and records it; the limit is decided from the event. */
export class CountMonthCommand implements CommandHandler<
  Command<CountMonthCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.entitlement.count_month",
    countMonthCommandDataSchema,
    "Count an organization's month",
  );

  private constructor(private readonly counting: UsageCountingService) {}

  static create({ counting }: { counting: UsageCountingService }): CountMonthCommand {
    return new CountMonthCommand(counting);
  }

  async handle(command: Command<CountMonthCommandData>): Promise<UsageEvent[]> {
    const { organizationId, month, occurredAt } = command.data;
    const data = await this.counting.countMonth({ organizationId, month, occurredAt });
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: USAGE_MONTH_COUNTED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt,
      }),
    ];
  }

  static getAggregateId(payload: CountMonthCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: CountMonthCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.usage.month": payload.month,
    };
  }
}

/** Records a refused-organizations decision; keyed so a redelivery records it once. */
export class RecordLimitDecisionCommand implements CommandHandler<
  Command<RecordLimitDecisionCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.entitlement.record_limit_decision",
    recordLimitDecisionCommandDataSchema,
    "Record a usage limit decision",
  );

  async handle(command: Command<RecordLimitDecisionCommandData>): Promise<UsageEvent[]> {
    const { decision, tenantId: _tenantId, ...data } = command.data;
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type:
          decision === "reached" ? USAGE_LIMIT_REACHED_EVENT_TYPE : USAGE_LIMIT_CLEARED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.month}:${decision}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordLimitDecisionCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: RecordLimitDecisionCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.usage.decision": payload.decision,
    };
  }
}

/** Records a crossed warning threshold; keyed by threshold and month, so it is stored once. */
export class RecordUsageWarningCommand implements CommandHandler<
  Command<RecordUsageWarningCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.entitlement.record_usage_warning",
    recordUsageWarningCommandDataSchema,
    "Record a crossed usage warning threshold",
  );

  async handle(command: Command<RecordUsageWarningCommandData>): Promise<UsageEvent[]> {
    const { tenantId: _tenantId, ...data } = command.data;
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: USAGE_THRESHOLD_CROSSED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.month}:${data.crossedThreshold}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordUsageWarningCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: RecordUsageWarningCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.usage.month": payload.month,
      "payload.usage.threshold": String(payload.crossedThreshold),
    };
  }
}

/** Counts a capped organization's scenario runs; records nothing before its first run. */
export class CountScenarioRunsCommand implements CommandHandler<
  Command<CountScenarioRunsCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.entitlement.count_scenario_runs",
    countScenarioRunsCommandDataSchema,
    "Count an organization's scenario runs for the month",
  );

  private constructor(private readonly runs: Pick<ScenarioRunCapService, "count">) {}

  static create({
    runs,
  }: {
    runs: Pick<ScenarioRunCapService, "count">;
  }): CountScenarioRunsCommand {
    return new CountScenarioRunsCommand(runs);
  }

  async handle(command: Command<CountScenarioRunsCommandData>): Promise<UsageEvent[]> {
    const { organizationId, month, occurredAt } = command.data;
    const data = await this.runs.count({ organizationId, month, occurredAt });
    if (!data || data.firstRunAt === null) return [];
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SCENARIO_RUNS_COUNTED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt,
      }),
    ];
  }

  static getAggregateId(payload: CountScenarioRunsCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: CountScenarioRunsCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.usage.month": payload.month,
    };
  }
}

/** Records the month's scenario run heads-up; keyed by month, so it is stored once. */
export class RecordScenarioRunsThresholdCommand implements CommandHandler<
  Command<RecordScenarioRunsThresholdCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.entitlement.record_scenario_runs_threshold",
    recordScenarioRunsThresholdCommandDataSchema,
    "Record that an organization reached its scenario run heads-up",
  );

  async handle(command: Command<RecordScenarioRunsThresholdCommandData>): Promise<UsageEvent[]> {
    const { tenantId: _tenantId, ...data } = command.data;
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SCENARIO_RUNS_THRESHOLD_REACHED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.month}:scenario_runs_threshold_reached`,
      }),
    ];
  }

  static getAggregateId(payload: RecordScenarioRunsThresholdCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: RecordScenarioRunsThresholdCommandData,
  ): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.usage.month": payload.month,
    };
  }
}

/** Records the end of the grace once; an organization that left the capped plan records none. */
export class RecordScenarioRunGraceEndedCommand implements CommandHandler<
  Command<RecordScenarioRunGraceEndedCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.entitlement.record_scenario_run_grace_ended",
    recordScenarioRunGraceEndedCommandDataSchema,
    "Record that an organization's scenario run grace ended",
  );

  private constructor(private readonly runs: Pick<ScenarioRunCapService, "isCapped">) {}

  static create({
    runs,
  }: {
    runs: Pick<ScenarioRunCapService, "isCapped">;
  }): RecordScenarioRunGraceEndedCommand {
    return new RecordScenarioRunGraceEndedCommand(runs);
  }

  async handle(command: Command<RecordScenarioRunGraceEndedCommandData>): Promise<UsageEvent[]> {
    const { tenantId: _tenantId, ...data } = command.data;
    if (!(await this.runs.isCapped({ organizationId: data.organizationId }))) return [];
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SCENARIO_RUN_GRACE_ENDED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:scenario_run_grace_ended`,
      }),
    ];
  }

  static getAggregateId(payload: RecordScenarioRunGraceEndedCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: RecordScenarioRunGraceEndedCommandData,
  ): Record<string, string> {
    return { "payload.organization.id": payload.organizationId };
  }
}
