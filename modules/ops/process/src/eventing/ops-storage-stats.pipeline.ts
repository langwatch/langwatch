import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { OpsApp } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import { STORAGE_STATS_PROCESS_NAME, runStorageStats } from "./ops-storage-stats.intent.ts";
import {
  STORAGE_STATS_INITIAL_STATE,
  STORAGE_STATS_INTERVAL_MS,
  type StorageStatsState,
  storageStatsMeasurementSchema,
  storageStatsWake,
} from "./ops-storage-stats.process.ts";

export const STORAGE_STATS_PIPELINE_NAME = "ops_storage_stats";

/** ClickHouse storage measured once across the fleet, a scheduled process with no events. */
export function buildStorageStats({
  app,
  processStore,
}: EventingSetup<unknown, Pick<OpsApp, "measureStorage">>): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: STORAGE_STATS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(STORAGE_STATS_PROCESS_NAME, (pm) =>
      pm
        .state<StorageStatsState>(STORAGE_STATS_INITIAL_STATE)
        .schedule({ everyMs: STORAGE_STATS_INTERVAL_MS })
        .onWake(storageStatsWake)
        .intent(
          "measure",
          storageStatsMeasurementSchema,
          runStorageStats({
            measure: () => app.measureStorage(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // One measurement at a time; a lease well past the queries' own timeouts.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}

export const storageStatsEventing = defineEventingModule({
  pipeline: STORAGE_STATS_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsApp>) => buildStorageStats(setup),
});
