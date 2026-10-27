import type { DatasetVersionAuthor } from "@langwatch/dataset-contract";
import {
  type CommandEnvelope,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { z } from "zod";

import type { DatasetModule } from "../app/dataset.app.ts";
import type { DatasetRepositories } from "../repositories/dataset.repositories.ts";
import {
  DATASET_AUTOSAVE_INITIAL_STATE,
  DATASET_AUTOSAVE_PROCESS_NAME,
  datasetAutosaveEdited,
  datasetAutosaveIntentSchema,
  datasetAutosaveStateSchema,
  datasetAutosaveWake,
} from "./dataset-autosave.process.ts";
import {
  DATASET_VERSION_RETENTION_INTERVAL_MS,
  DATASET_VERSION_RETENTION_PROCESS_NAME,
  datasetVersionRetentionIntentSchema,
  datasetVersionRetentionStateSchema,
  datasetVersionRetentionWake,
} from "./dataset-version-retention.process.ts";
import {
  DATASET_HISTORY_AGGREGATE_TYPE,
  datasetContentEditedEventSchema,
  type DatasetContentEditedEvent,
  type DatasetVersionRestoredEvent,
  datasetVersionRestoredEventSchema,
  type DatasetVersionSavedEvent,
  datasetVersionSavedEventSchema,
  RecordDatasetContentEditCommand,
  RecordDatasetVersionRestoredCommand,
  RecordDatasetVersionSavedCommand,
} from "./dataset-versions.commands.ts";

const DATASET_VERSIONS_PIPELINE_NAME = "dataset_versions";

/** What the pipeline needs of the app: the autosave and the retention sweep. */
export type DatasetVersionWork = {
  autosave(input: {
    projectId: string;
    datasetId: string;
    editedBy: DatasetVersionAuthor;
  }): Promise<void>;
  sweepVersionRetention(input: { nowMs: number }): Promise<void>;
};

export type DatasetVersionsDefinition = StaticPipelineDefinition<
  DatasetContentEditedEvent | DatasetVersionSavedEvent | DatasetVersionRestoredEvent,
  Record<string, Projection>,
  | {
      name: "recordDatasetContentEdit";
      payload: z.infer<typeof datasetContentEditedEventSchema>["data"] & CommandEnvelope;
    }
  | {
      name: "recordDatasetVersionSaved";
      payload: z.infer<typeof datasetVersionSavedEventSchema>["data"] & CommandEnvelope;
    }
  | {
      name: "recordDatasetVersionRestored";
      payload: z.infer<typeof datasetVersionRestoredEventSchema>["data"] & CommandEnvelope;
    }
>;

/**
 * Dataset versions (spec modules/dataset/specs/dataset-versioning.feature): edits
 * are recorded as facts, the autosave process saves a version once they go
 * quiet, and a scheduled sweep thins old history.
 */
export function buildDatasetVersionsPipeline(work: DatasetVersionWork): DatasetVersionsDefinition {
  return definePipeline({
    name: DATASET_VERSIONS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: DATASET_HISTORY_AGGREGATE_TYPE }),
  })
    .withEvents([
      datasetContentEditedEventSchema,
      datasetVersionSavedEventSchema,
      datasetVersionRestoredEventSchema,
    ])
    .withCommand("recordDatasetContentEdit", RecordDatasetContentEditCommand)
    .withCommand("recordDatasetVersionSaved", RecordDatasetVersionSavedCommand)
    .withCommand("recordDatasetVersionRestored", RecordDatasetVersionRestoredCommand)
    .withProcessManager(DATASET_AUTOSAVE_PROCESS_NAME, (pm) =>
      pm
        .state(datasetAutosaveStateSchema, DATASET_AUTOSAVE_INITIAL_STATE)
        .intent("snapshot", datasetAutosaveIntentSchema, async (payload, context) => {
          await work.autosave({ projectId: context.projectId, ...payload });
        })
        .on(datasetContentEditedEventSchema, datasetAutosaveEdited)
        .onWake(datasetAutosaveWake)
        .outbox({ maxAttempts: 5 }),
    )
    .withProcessManager(DATASET_VERSION_RETENTION_PROCESS_NAME, (pm) =>
      pm
        .state(datasetVersionRetentionStateSchema, { lastSweepAt: null })
        .schedule({ everyMs: DATASET_VERSION_RETENTION_INTERVAL_MS })
        .onWake(datasetVersionRetentionWake)
        .intent("sweep", datasetVersionRetentionIntentSchema, async ({ scheduledFor }) => {
          await work.sweepVersionRetention({ nowMs: scheduledFor });
        })
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 15 * 60 * 1000 }),
    )
    .build();
}

export const datasetVersionsEventing = defineEventingModule({
  pipeline: DATASET_VERSIONS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DatasetRepositories, DatasetModule>) => app.versionsPipeline(),
  connect: ({ app, commands }) =>
    app.connectVersions({
      recordContentEdit: commands.recordDatasetContentEdit,
      recordVersionSaved: commands.recordDatasetVersionSaved,
      recordVersionRestored: commands.recordDatasetVersionRestored,
    }),
});
