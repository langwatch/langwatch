import {
  USAGE_LIMIT_CLEARED_EVENT_TYPE,
  USAGE_LIMIT_REACHED_EVENT_TYPE,
  USAGE_MONTH_COUNTED_EVENT_TYPE,
  USAGE_PIPELINE_NAME,
} from "@langwatch/entitlement-contract";
import {
  type AppendStore,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { EntitlementModule } from "../app/entitlement.app.ts";
import type { BillableEventRecord } from "../repositories/billable-events-meter.repository.ts";
import type { TenancyRepository } from "../repositories/tenancy.repository.ts";
import type { TraceUsageService } from "../services/trace-usage.service.ts";
import { BillableEventsMeterProjection } from "./billable-events-meter.projection.ts";
import {
  limitStateSchema,
  monthCounted,
  REFUSED_ORGANIZATIONS_PROCESS_NAME,
  refusedOrganizationWake,
} from "./refused-organizations.process.ts";
import {
  TRACE_USAGE_MONTH_IDS_SUBSCRIBER_NAME,
  TRACE_USAGE_SPAN_SUBSCRIBER_NAME,
  traceUsageMonthIdsSubscriber,
  traceUsageSpanSubscriber,
} from "./trace-usage.subscriber.ts";
import { scenarioRunCountSubscriber } from "./scenario-run-count.subscriber.ts";
import {
  initialScenarioRunNoticesState,
  SCENARIO_RUN_NOTICES_PROCESS_NAME,
  scenarioRunGraceWake,
  scenarioRunNoticesStateSchema,
  scenarioRunsCounted,
} from "./scenario-run-notices.process.ts";
import { usageMeterCountSubscriber } from "./usage-meter-count.subscriber.ts";
import {
  CountMonthCommand,
  CountScenarioRunsCommand,
  RecordLimitDecisionCommand,
  RecordScenarioRunGraceEndedCommand,
  RecordScenarioRunsThresholdCommand,
  RecordUsageWarningCommand,
} from "./usage.commands.ts";
import {
  type CountMonthCommandData,
  type CountScenarioRunsCommandData,
  type RecordScenarioRunGraceEndedCommandData,
  recordScenarioRunGraceEndedCommandDataSchema,
  type RecordScenarioRunsThresholdCommandData,
  recordScenarioRunsThresholdCommandDataSchema,
  scenarioRunGraceEndedEventSchema,
  scenarioRunsCountedEventSchema,
  scenarioRunsThresholdReachedEventSchema,
  countMonthCommandDataSchema,
  limitClearedEventSchema,
  limitReachedEventSchema,
  monthCountedEventSchema,
  type RecordLimitDecisionCommandData,
  recordLimitDecisionCommandDataSchema,
  type RecordUsageWarningCommandData,
  USAGE_AGGREGATE_TYPE,
  type UsageEvent,
  usageThresholdCrossedEventSchema,
} from "./usage.events.ts";

export type UsagePipelineDefinition = StaticPipelineDefinition<
  UsageEvent,
  Record<string, Projection>,
  | { name: "countMonth"; payload: CountMonthCommandData }
  | { name: "recordLimitDecision"; payload: RecordLimitDecisionCommandData }
  | { name: "recordUsageWarning"; payload: RecordUsageWarningCommandData }
  | { name: "countScenarioRuns"; payload: CountScenarioRunsCommandData }
  | { name: "recordScenarioRunsThreshold"; payload: RecordScenarioRunsThresholdCommandData }
  | { name: "recordScenarioRunGraceEnded"; payload: RecordScenarioRunGraceEndedCommandData }
>;

export type UsageSenders = Readonly<{
  countMonth: (data: CountMonthCommandData) => Promise<void>;
  recordLimitDecision: (data: RecordLimitDecisionCommandData) => Promise<void>;
  recordUsageWarning: (data: RecordUsageWarningCommandData) => Promise<void>;
  countScenarioRuns: (data: CountScenarioRunsCommandData) => Promise<void>;
  recordScenarioRunsThreshold: (data: RecordScenarioRunsThresholdCommandData) => Promise<void>;
  recordScenarioRunGraceEnded: (data: RecordScenarioRunGraceEndedCommandData) => Promise<void>;
}>;

/**
 * The metering pipeline. Trace usage is written on every deployment (round 22); the
 * billable-events meter, its subscriber and the limit decider stay SaaS only.
 */
export function buildUsagePipeline({
  countMonth,
  countScenarioRuns,
  recordScenarioRunGraceEnded,
  traceUsage,
  billableEventsMeter,
  projects,
  send,
}: {
  countMonth: CountMonthCommand;
  countScenarioRuns: CountScenarioRunsCommand;
  recordScenarioRunGraceEnded: RecordScenarioRunGraceEndedCommand;
  traceUsage: Pick<TraceUsageService, "recordTraces">;
  billableEventsMeter: AppendStore<BillableEventRecord> | undefined;
  projects: Pick<TenancyRepository, "getProjectPlacement">;
  send: () => UsageSenders;
}): UsagePipelineDefinition {
  const pipeline = definePipeline({
    name: USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: USAGE_AGGREGATE_TYPE }),
  })
    .withEvents([
      monthCountedEventSchema,
      limitReachedEventSchema,
      limitClearedEventSchema,
      usageThresholdCrossedEventSchema,
      scenarioRunsCountedEventSchema,
      scenarioRunsThresholdReachedEventSchema,
      scenarioRunGraceEndedEventSchema,
    ])
    // Usage's stored names (Alex, 2026-10-06); jobs queued under `usage:` drain into these lanes.
    .withUpcasts({
      events: [
        {
          from: { type: "lw.usage.month_counted", aggregateType: "usage_organization" },
          to: USAGE_MONTH_COUNTED_EVENT_TYPE,
        },
        {
          from: { type: "lw.usage.limit_reached", aggregateType: "usage_organization" },
          to: USAGE_LIMIT_REACHED_EVENT_TYPE,
        },
        {
          from: { type: "lw.usage.limit_cleared", aggregateType: "usage_organization" },
          to: USAGE_LIMIT_CLEARED_EVENT_TYPE,
        },
      ],
      drain: { pipeline: "usage" },
    })
    .withCommandInstance({
      name: "countMonth",
      handlerClass: CountMonthCommand,
      instance: countMonth,
      options: {
        delay: 300_000,
        deduplication: {
          makeId: (p: CountMonthCommandData) => `${p.organizationId}:${p.month}`,
          ttlMs: 310_000,
        },
      },
    })
    .withCommand("recordLimitDecision", RecordLimitDecisionCommand)
    .withCommand("recordUsageWarning", RecordUsageWarningCommand)
    .withCommandInstance({
      name: "countScenarioRuns",
      handlerClass: CountScenarioRunsCommand,
      instance: countScenarioRuns,
      options: {
        delay: 30_000,
        deduplication: {
          makeId: (p: CountScenarioRunsCommandData) => `scenario-runs:${p.organizationId}:${p.month}`,
          ttlMs: 35_000,
        },
      },
    })
    .withCommand("recordScenarioRunsThreshold", RecordScenarioRunsThresholdCommand)
    .withCommandInstance({
      name: "recordScenarioRunGraceEnded",
      handlerClass: RecordScenarioRunGraceEndedCommand,
      instance: recordScenarioRunGraceEnded,
    })
    .withPeerSubscriber(TRACE_USAGE_SPAN_SUBSCRIBER_NAME, traceUsageSpanSubscriber(traceUsage))
    .withPeerSubscriber(
      TRACE_USAGE_MONTH_IDS_SUBSCRIBER_NAME,
      traceUsageMonthIdsSubscriber(traceUsage),
    );
  if (!billableEventsMeter) return pipeline.build();
  return (
    pipeline
      .withProcessManager(REFUSED_ORGANIZATIONS_PROCESS_NAME, (pm) =>
        pm
          .state(limitStateSchema, { month: null, reached: false })
          .intent("recordLimitDecision", recordLimitDecisionCommandDataSchema, (data) =>
            send().recordLimitDecision(data),
          )
          .intent("countMonth", countMonthCommandDataSchema, (data) => send().countMonth(data))
          .on(monthCountedEventSchema, monthCounted)
          .keyBy((event) => event.aggregateId)
          .onWake(refusedOrganizationWake),
      )
      .withProcessManager(SCENARIO_RUN_NOTICES_PROCESS_NAME, (pm) =>
        pm
          .state(scenarioRunNoticesStateSchema, initialScenarioRunNoticesState)
          .intent(
            "recordScenarioRunsThreshold",
            recordScenarioRunsThresholdCommandDataSchema,
            (data) => send().recordScenarioRunsThreshold(data),
          )
          .intent(
            "recordScenarioRunGraceEnded",
            recordScenarioRunGraceEndedCommandDataSchema,
            (data) => send().recordScenarioRunGraceEnded(data),
          )
          .on(scenarioRunsCountedEventSchema, scenarioRunsCounted)
          .keyBy((event) => event.aggregateId)
          .onWake(scenarioRunGraceWake),
      )
      .withGlobalMapProjection(BillableEventsMeterProjection.create(billableEventsMeter).build(), [
        usageMeterCountSubscriber({ projects, countMonth: (data) => send().countMonth(data) }),
        scenarioRunCountSubscriber({
          projects,
          countScenarioRuns: (data) => send().countScenarioRuns(data),
        }),
      ])
      // Cloud only: main's meter dispatch, renamed. Its body is the reactor's, so no transform.
      .withLaneAliases([
        {
          from: "global:reactor:billingMeterDispatch",
          to: { jobType: "reactor", lane: "usageMeterCount" },
        },
      ])
      .build()
  );
}

export const usageEventing = defineEventingModule({
  pipeline: USAGE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, EntitlementModule>) => app.usagePipeline(),
  connect: ({ app, commands }) => app.connectUsageCommands(commands),
});
