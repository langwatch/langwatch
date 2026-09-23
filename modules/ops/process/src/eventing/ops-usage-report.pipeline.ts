import {
  defineAggregate,
  defineEventingModule,
  defineEvents,
  definePipeline,
  type Event,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { OpsApp } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import { USAGE_REPORT_PROCESS_NAME, type UsageReportRunDeps } from "./ops-usage-report.intent.ts";
import { usageReportPM } from "./ops-usage-report.process.ts";

export const USAGE_REPORT_PIPELINE_NAME = "ops_usage_report";

/**
 * The self-hosted install's daily usage report, a scheduled process with no
 * events of its own. `global`, like the other maintenance pipelines: the
 * report spans every tenant by design.
 */
export function buildOpsUsageReportPipeline(
  deps: UsageReportRunDeps,
): StaticPipelineDefinition<Event> {
  return definePipeline<Event>({
    name: USAGE_REPORT_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global", events: defineEvents([]) }),
  })
    .withProcessManager(USAGE_REPORT_PROCESS_NAME, usageReportPM(deps))
    .build();
}

/** The pipeline over only the one app operation it calls. */
export function buildUsageReport({
  app,
  processStore,
}: EventingSetup<unknown, Pick<OpsApp, "sendUsageReport">>): StaticPipelineDefinition<Event> {
  return buildOpsUsageReportPipeline({
    send: () => app.sendUsageReport(),
    deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    now: () => nowInstant().epochMilliseconds,
  });
}

export const usageReportEventing = defineEventingModule({
  pipeline: USAGE_REPORT_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsApp>) => buildUsageReport(setup),
});
