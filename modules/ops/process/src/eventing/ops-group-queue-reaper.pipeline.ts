import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { OpsApi } from "@langwatch/ops-contract";

import type { OpsModule } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import {
  GROUP_QUEUE_REAPER_PROCESS_NAME,
  runGroupQueueReap,
} from "./ops-group-queue-reaper.intent.ts";
import {
  GROUP_QUEUE_REAPER_INITIAL_STATE,
  GROUP_QUEUE_REAPER_INTERVAL_MS,
  groupQueueReapSchema,
  groupQueueReaperStateSchema,
  groupQueueReaperWake,
} from "./ops-group-queue-reaper.process.ts";

export const GROUP_QUEUE_REAPER_PIPELINE_NAME = "ops_group_queue_reaper";

/** Stranded queue groups reaped once across the fleet, a scheduled process with no events. */
export function buildGroupQueueReaper({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<OpsApi, "reapStrandedQueueGroups">
>): StaticPipelineDefinition<never> {
  return definePipeline({
    name: GROUP_QUEUE_REAPER_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(GROUP_QUEUE_REAPER_PROCESS_NAME, (pm) =>
      pm
        .state(groupQueueReaperStateSchema, GROUP_QUEUE_REAPER_INITIAL_STATE)
        .schedule({ everyMs: GROUP_QUEUE_REAPER_INTERVAL_MS })
        .onWake(groupQueueReaperWake)
        .intent(
          "reap",
          groupQueueReapSchema,
          runGroupQueueReap({
            reap: () =>
              app.reapStrandedQueueGroups({ requestedBy: GROUP_QUEUE_REAPER_PIPELINE_NAME }),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // One reap at a time across the fleet; a SCAN over a bloated Redis can take minutes.
        .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}

export const groupQueueReaperEventing = defineEventingModule({
  pipeline: GROUP_QUEUE_REAPER_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsModule>) => buildGroupQueueReaper(setup),
});
