/**
 * The daily retention storage report (specs/billing/retention-storage-billing.feature): the clock
 * sends one measure command per organization, the command records the day's measurement, and the
 * billing process sends it to billing's meter, retried apart from the measuring.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import { ReportRetentionStorageCommand } from "./retention-storage-report.commands.ts";
import {
  retentionStorageMeasuredEventSchema,
  RETENTION_STORAGE_AGGREGATE_TYPE,
  RETENTION_STORAGE_PIPELINE_NAME,
  type RetentionStorageMeasuredEventData,
} from "./retention-storage-report.events.ts";
import {
  runRetentionStorageBill,
  runRetentionStorageReportSweep,
  type RetentionStorageReportSweepDeps,
} from "./retention-storage-report.intent.ts";
import {
  RETENTION_STORAGE_BILLING_INITIAL_STATE,
  RETENTION_STORAGE_BILLING_PROCESS_NAME,
  RETENTION_STORAGE_REPORT_INITIAL_STATE,
  RETENTION_STORAGE_REPORT_INTERVAL_MS,
  RETENTION_STORAGE_REPORT_PROCESS_NAME,
  retentionStorageBillingStateSchema,
  retentionStorageBillSchema,
  retentionStorageMeasured,
  retentionStorageReportStateSchema,
  retentionStorageReportSweepSchema,
  retentionStorageReportWake,
} from "./retention-storage-report.process.ts";

export interface RetentionStorageReportPipelineDeps {
  reportCommand: ReportRetentionStorageCommand;
  sweep: RetentionStorageReportSweepDeps;
  bill: (measured: RetentionStorageMeasuredEventData) => Promise<unknown>;
  /** The bill's backoff; tests shorten it, the deployment keeps the default. */
  billRetryDelayMs?: (params: { attempt: number }) => number;
}

/** A Stripe outage of a few hours still lands the day: a minute, doubling, at most an hour. */
const BILL_MAX_ATTEMPTS = 12;
const billRetryDelayMs = ({ attempt }: { attempt: number }): number =>
  Math.min(60_000 * 2 ** (attempt - 1), 60 * 60_000);

const defineRetentionStorageReportPipeline = (deps: RetentionStorageReportPipelineDeps) =>
  definePipeline({
    name: RETENTION_STORAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: RETENTION_STORAGE_AGGREGATE_TYPE }),
  })
    .withEvents([retentionStorageMeasuredEventSchema])
    .withCommandInstance({
      name: "reportRetentionStorage",
      handlerClass: ReportRetentionStorageCommand,
      instance: deps.reportCommand,
    })
    .withProcessManager(RETENTION_STORAGE_REPORT_PROCESS_NAME, (pm) =>
      pm
        .state(retentionStorageReportStateSchema, RETENTION_STORAGE_REPORT_INITIAL_STATE)
        .schedule({ everyMs: RETENTION_STORAGE_REPORT_INTERVAL_MS })
        .onWake(retentionStorageReportWake)
        .intent(
          "sweep",
          retentionStorageReportSweepSchema,
          runRetentionStorageReportSweep(deps.sweep),
        )
        // The sweep only sends commands; a rerun resends them and the day's key absorbs it.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .withProcessManager(RETENTION_STORAGE_BILLING_PROCESS_NAME, (pm) =>
      pm
        .state(retentionStorageBillingStateSchema, RETENTION_STORAGE_BILLING_INITIAL_STATE)
        .intent("bill", retentionStorageBillSchema, runRetentionStorageBill({ bill: deps.bill }))
        .on(retentionStorageMeasuredEventSchema, retentionStorageMeasured)
        .outbox({
          maxAttempts: BILL_MAX_ATTEMPTS,
          retryDelayMs: deps.billRetryDelayMs ?? billRetryDelayMs,
          concurrency: 4,
          batchSize: 4,
        }),
    )
    .build();

export type RetentionStorageReportPipelineDefinition = ReturnType<
  typeof defineRetentionStorageReportPipeline
>;

export function buildRetentionStorageReportPipeline(
  deps: RetentionStorageReportPipelineDeps,
): RetentionStorageReportPipelineDefinition {
  return defineRetentionStorageReportPipeline(deps);
}

export const retentionStorageReportEventing = defineEventingModule({
  pipeline: RETENTION_STORAGE_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    app.storageReportPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
  connect: ({ app, commands }) => app.connectStorageReportCommands(commands),
});
