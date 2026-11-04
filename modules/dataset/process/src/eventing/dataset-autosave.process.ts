/**
 * The autosave process, one per dataset: every edit pushes the save back to
 * the end of the quiet period, and the wake after it asks for one snapshot.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */
import {
  DATASET_VERSION_QUIET_MS,
  datasetVersionAuthorSchema,
  type DatasetContentEditedEventData,
} from "@langwatch/dataset-contract";
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const DATASET_AUTOSAVE_PROCESS_NAME = "datasetAutosave" as const;

export const datasetAutosaveStateSchema = z.object({
  datasetId: z.string().nullable(),
  /** When the edits will have been quiet long enough; null while nothing waits. */
  dueAt: z.number().nullable(),
  editedBy: datasetVersionAuthorSchema.nullable(),
});
export type DatasetAutosaveState = z.infer<typeof datasetAutosaveStateSchema>;

export const DATASET_AUTOSAVE_INITIAL_STATE: DatasetAutosaveState = {
  datasetId: null,
  dueAt: null,
  editedBy: null,
};

export const datasetAutosaveIntentSchema = z.object({
  datasetId: z.string().min(1),
  editedBy: datasetVersionAuthorSchema,
});

type AutosaveIntents = { snapshot: IntentSpec<typeof datasetAutosaveIntentSchema> };

export const datasetAutosaveEdited: EventHandler<
  DatasetAutosaveState,
  DatasetContentEditedEventData,
  AutosaveIntents
> = (_state, data, ctx) => {
  const dueAt = Math.max(ctx.at, ctx.now) + DATASET_VERSION_QUIET_MS;
  return {
    state: { datasetId: data.datasetId, dueAt, editedBy: data.editedBy },
    nextWakeAt: dueAt,
  };
};

export const datasetAutosaveWake: WakeHandler<DatasetAutosaveState, AutosaveIntents> = (
  state,
  ctx,
) => {
  const { datasetId, dueAt, editedBy } = state;
  if (datasetId === null || dueAt === null || editedBy === null) {
    return { state, nextWakeAt: null };
  }
  if (Math.max(ctx.at, ctx.now) < dueAt) return { state, nextWakeAt: dueAt };
  return {
    state: DATASET_AUTOSAVE_INITIAL_STATE,
    nextWakeAt: null,
    intents: [ctx.intent("snapshot", `autosave:${datasetId}:${dueAt}`, { datasetId, editedBy })],
  };
};
