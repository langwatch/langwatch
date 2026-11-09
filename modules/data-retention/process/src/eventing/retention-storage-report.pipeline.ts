/**
 * The daily retention storage report (specs/billing/retention-storage-billing.feature): every
 * organization's storage past the included 90 days goes to billing's meter as that day's share.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import {
  runRetentionStorageReportSweep,
  type RetentionStorageReportSweepDeps,
} from "./retention-storage-report.intent.ts";
import {
  RETENTION_STORAGE_REPORT_INITIAL_STATE,
  RETENTION_STORAGE_REPORT_INTERVAL_MS,
  RETENTION_STORAGE_REPORT_PIPELINE_NAME,
  RETENTION_STORAGE_REPORT_PROCESS_NAME,
  retentionStorageReportStateSchema,
  retentionStorageReportSweepSchema,
  retentionStorageReportWake,
} from "./retention-storage-report.process.ts";

export const retentionStorageReportEventing = defineEventingModule({
  pipeline: RETENTION_STORAGE_REPORT_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    buildRetentionStorageReportPipeline({
      sweep: () => app.reportRetentionStorage(),
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});

/** A scheduled sweep, no events: the report is due by the clock, not by a fact. */
export function buildRetentionStorageReportPipeline(
  deps: RetentionStorageReportSweepDeps,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: RETENTION_STORAGE_REPORT_PIPELINE_NAME,
    // `global`: the sweep spans every organization by design and appends nothing.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(RETENTION_STORAGE_REPORT_PROCESS_NAME, (pm) =>
      pm
        .state(retentionStorageReportStateSchema, RETENTION_STORAGE_REPORT_INITIAL_STATE)
        .schedule({ everyMs: RETENTION_STORAGE_REPORT_INTERVAL_MS })
        .onWake(retentionStorageReportWake)
        .intent("sweep", retentionStorageReportSweepSchema, runRetentionStorageReportSweep(deps))
        // One pass at a time; the per-day meter identifier stops a double report anyway.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 30 * 60 * 1000 }),
    )
    .build();
}
