import {
  DATASET_CONTENT_EDITED_EVENT_TYPE,
  DATASET_VERSION_EVENT_VERSION,
  DATASET_VERSION_RESTORED_EVENT_TYPE,
  DATASET_VERSION_SAVED_EVENT_TYPE,
  datasetContentEditedEventDataSchema,
  datasetVersionRestoredEventDataSchema,
  datasetVersionSavedEventDataSchema,
} from "@langwatch/dataset-contract";
import { defineCommand, EventSchema } from "@langwatch/eventing";
import { z } from "zod";

/** One aggregate per dataset's history, apart from the dataset aggregate normalization owns. */
export const DATASET_HISTORY_AGGREGATE_TYPE = "dataset_history" as const;

export const datasetContentEditedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DATASET_CONTENT_EDITED_EVENT_TYPE),
  version: z.literal(DATASET_VERSION_EVENT_VERSION),
  data: datasetContentEditedEventDataSchema,
});
export type DatasetContentEditedEvent = z.infer<typeof datasetContentEditedEventSchema>;

export const datasetVersionSavedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DATASET_VERSION_SAVED_EVENT_TYPE),
  version: z.literal(DATASET_VERSION_EVENT_VERSION),
  data: datasetVersionSavedEventDataSchema,
});
export type DatasetVersionSavedEvent = z.infer<typeof datasetVersionSavedEventSchema>;

export const datasetVersionRestoredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DATASET_VERSION_RESTORED_EVENT_TYPE),
  version: z.literal(DATASET_VERSION_EVENT_VERSION),
  data: datasetVersionRestoredEventDataSchema,
});
export type DatasetVersionRestoredEvent = z.infer<typeof datasetVersionRestoredEventSchema>;

/** One edit of a dataset's columns or rows; the autosave process waits for them to go quiet. */
export const RecordDatasetContentEditCommand = defineCommand({
  commandType: "lw.dataset.content.record_edit",
  eventType: DATASET_CONTENT_EDITED_EVENT_TYPE,
  eventVersion: DATASET_VERSION_EVENT_VERSION,
  aggregateType: DATASET_HISTORY_AGGREGATE_TYPE,
  schema: datasetContentEditedEventDataSchema,
  aggregateId: (data) => data.datasetId,
  idempotencyKey: (data) => `dataset_edit:${data.datasetId}:${data.occurredAt}`,
});

/** A saved version, so the history refreshes wherever it is open. */
export const RecordDatasetVersionSavedCommand = defineCommand({
  commandType: "lw.dataset.version.record_saved",
  eventType: DATASET_VERSION_SAVED_EVENT_TYPE,
  eventVersion: DATASET_VERSION_EVENT_VERSION,
  aggregateType: DATASET_HISTORY_AGGREGATE_TYPE,
  schema: datasetVersionSavedEventDataSchema,
  aggregateId: (data) => data.datasetId,
  idempotencyKey: (data) => `dataset_version_saved:${data.versionId}`,
});

/** A restore replaced the dataset's content, so its rows and history refresh wherever open. */
export const RecordDatasetVersionRestoredCommand = defineCommand({
  commandType: "lw.dataset.version.record_restored",
  eventType: DATASET_VERSION_RESTORED_EVENT_TYPE,
  eventVersion: DATASET_VERSION_EVENT_VERSION,
  aggregateType: DATASET_HISTORY_AGGREGATE_TYPE,
  schema: datasetVersionRestoredEventDataSchema,
  aggregateId: (data) => data.datasetId,
  idempotencyKey: (data) => `dataset_version_restored:${data.versionId}`,
});
