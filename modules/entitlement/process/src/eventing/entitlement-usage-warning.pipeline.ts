/**
 * The daily usage-limit warning over every organization: a scheduled process
 * with no events of its own. `global`, because one sweep walks them all.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
  type Event,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { EntitlementApp } from "../app/entitlement.app.ts";
import type { EntitlementRepositories } from "../repositories/entitlement.repositories.ts";
import {
  USAGE_WARNING_SWEEP_INTERVAL_MS,
  USAGE_WARNING_SWEEP_PROCESS_NAME,
  runUsageWarningSweep,
  usageWarningSweepSchema,
  usageWarningSweepWake,
  type UsageWarningSweepRunDeps,
  type UsageWarningSweepState,
} from "./entitlement-usage-warning.process.ts";

export const USAGE_WARNING_PIPELINE_NAME = "entitlement_usage_warning";

export function buildUsageWarningPipeline(
  deps: Omit<UsageWarningSweepRunDeps, "now">,
): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: USAGE_WARNING_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(USAGE_WARNING_SWEEP_PROCESS_NAME, (pm) =>
      pm
        .state<UsageWarningSweepState>({ lastSweepAt: null })
        .schedule({ everyMs: USAGE_WARNING_SWEEP_INTERVAL_MS })
        .onWake(usageWarningSweepWake)
        .intent(
          "sweep",
          usageWarningSweepSchema,
          runUsageWarningSweep({ ...deps, now: () => nowInstant().epochMilliseconds }),
        )
        // One sweep mails admins; a retry is safe because each threshold is recorded once a month.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 30 * 60 * 1000 }),
    )
    .build();
}

export const entitlementUsageWarningEventing = defineEventingModule({
  pipeline: USAGE_WARNING_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<EntitlementRepositories, EntitlementApp>) =>
    app.usageWarningEventingPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});
