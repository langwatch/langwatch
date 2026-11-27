/**
 * The daily retention drift check (modules/data-retention/specs/retention-drift-check.feature):
 * the clock sends one check command per organization with rules, and the command records the
 * projects whose sampled stored rows carry a period other than their current one.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import { CheckRetentionDriftCommand } from "./retention-drift.commands.ts";
import {
  retentionDriftDetectedEventSchema,
  RETENTION_DRIFT_AGGREGATE_TYPE,
  RETENTION_DRIFT_PIPELINE_NAME,
} from "./retention-drift.events.ts";
import { runRetentionDriftSweep, type RetentionDriftSweepDeps } from "./retention-drift.intent.ts";
import {
  RETENTION_DRIFT_INITIAL_STATE,
  RETENTION_DRIFT_INTERVAL_MS,
  RETENTION_DRIFT_PROCESS_NAME,
  retentionDriftStateSchema,
  retentionDriftSweepSchema,
  retentionDriftWake,
} from "./retention-drift.process.ts";

export interface RetentionDriftPipelineDeps {
  checkCommand: CheckRetentionDriftCommand;
  sweep: RetentionDriftSweepDeps;
}

const defineRetentionDriftPipeline = (deps: RetentionDriftPipelineDeps) =>
  definePipeline({
    name: RETENTION_DRIFT_PIPELINE_NAME,
    aggregate: defineAggregate({ type: RETENTION_DRIFT_AGGREGATE_TYPE }),
  })
    .withEvents([retentionDriftDetectedEventSchema])
    .withCommandInstance({
      name: "checkRetentionDrift",
      handlerClass: CheckRetentionDriftCommand,
      instance: deps.checkCommand,
    })
    .withProcessManager(RETENTION_DRIFT_PROCESS_NAME, (pm) =>
      pm
        .state(retentionDriftStateSchema, RETENTION_DRIFT_INITIAL_STATE)
        .schedule({ everyMs: RETENTION_DRIFT_INTERVAL_MS })
        .onWake(retentionDriftWake)
        .intent("sweep", retentionDriftSweepSchema, runRetentionDriftSweep(deps.sweep))
        // The sweep only sends commands; a rerun resends them and the wake's key absorbs it.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .build();

export type RetentionDriftPipelineDefinition = ReturnType<typeof defineRetentionDriftPipeline>;

export function buildRetentionDriftPipeline(
  deps: RetentionDriftPipelineDeps,
): RetentionDriftPipelineDefinition {
  return defineRetentionDriftPipeline(deps);
}

export const retentionDriftEventing = defineEventingModule({
  pipeline: RETENTION_DRIFT_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    app.driftCheckPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
  connect: ({ app, commands }) => app.connectDriftCheckCommands(commands),
});
