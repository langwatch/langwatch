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
import type { ProjectApi } from "@langwatch/project-contract";

import type { EntitlementModule } from "../app/entitlement.app.ts";
import type { BillableEventRecord } from "../repositories/billable-events-meter.repository.ts";
import type { TraceMeterRecord } from "../repositories/trace-meter.repository.ts";
import { BillableEventsMeterProjection } from "./billable-events-meter.projection.ts";
import {
  limitStateSchema,
  monthCounted,
  REFUSED_ORGANIZATIONS_PROCESS_NAME,
  refusedOrganizationWake,
} from "./refused-organizations.process.ts";
import { TraceMeterProjection } from "./trace-meter.projection.ts";
import { usageMeterCountSubscriber } from "./usage-meter-count.subscriber.ts";
import { CountMonthCommand, RecordLimitDecisionCommand } from "./usage.commands.ts";
import {
  type CountMonthCommandData,
  countMonthCommandDataSchema,
  limitClearedEventSchema,
  limitReachedEventSchema,
  monthCountedEventSchema,
  type RecordLimitDecisionCommandData,
  recordLimitDecisionCommandDataSchema,
  USAGE_AGGREGATE_TYPE,
  type UsageEvent,
} from "./usage.events.ts";

export type UsagePipelineDefinition = StaticPipelineDefinition<
  UsageEvent,
  Record<string, Projection>,
  | { name: "countMonth"; payload: CountMonthCommandData }
  | { name: "recordLimitDecision"; payload: RecordLimitDecisionCommandData }
>;

export type UsageSenders = Readonly<{
  countMonth: (data: CountMonthCommandData) => Promise<void>;
  recordLimitDecision: (data: RecordLimitDecisionCommandData) => Promise<void>;
}>;

/** The two meters' append sides; both are written on SaaS only. */
type UsageMeterStores = Readonly<{
  billableEvents: AppendStore<BillableEventRecord>;
  traces: AppendStore<TraceMeterRecord>;
}>;

/** The metering pipeline; the meters, their subscriber and the limit decider are SaaS only. */
export function buildUsagePipeline({
  countMonth,
  meterStores,
  projects,
  send,
}: {
  countMonth: CountMonthCommand;
  meterStores: UsageMeterStores | undefined;
  projects: Pick<ProjectApi, "findOrganizationId">;
  send: () => UsageSenders;
}): UsagePipelineDefinition {
  const pipeline = definePipeline({
    name: USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: USAGE_AGGREGATE_TYPE }),
  })
    .withEvents([monthCountedEventSchema, limitReachedEventSchema, limitClearedEventSchema])
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
    .withCommand("recordLimitDecision", RecordLimitDecisionCommand);
  if (!meterStores) return pipeline.build();
  return pipeline
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
    .withGlobalMapProjection(
      BillableEventsMeterProjection.create(meterStores.billableEvents).build(),
      [usageMeterCountSubscriber({ projects, countMonth: (data) => send().countMonth(data) })],
    )
    .withGlobalMapProjection(TraceMeterProjection.create(meterStores.traces).build())
    .build();
}

export const usageEventing = defineEventingModule({
  pipeline: USAGE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, EntitlementModule>) => app.usagePipeline(),
  connect: ({ app, commands }) => app.connectUsageCommands(commands),
});
