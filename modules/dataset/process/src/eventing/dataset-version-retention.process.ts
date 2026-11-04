/**
 * The retention process: a scheduled wake asks for one sweep that thins old
 * dataset history. Spec: modules/dataset/specs/dataset-versioning.feature.
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const DATASET_VERSION_RETENTION_PROCESS_NAME = "datasetVersionRetention" as const;

/** How often the retention sweep walks every dataset's history. */
export const DATASET_VERSION_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The schedule decides when a sweep runs, so the process keeps no state of its own. */
export const datasetVersionRetentionStateSchema = z.object({});
type DatasetVersionRetentionState = z.infer<typeof datasetVersionRetentionStateSchema>;

export const datasetVersionRetentionIntentSchema = z.object({ scheduledFor: z.number().int() });

type RetentionIntents = { sweep: IntentSpec<typeof datasetVersionRetentionIntentSchema> };

export const datasetVersionRetentionWake: WakeHandler<
  DatasetVersionRetentionState,
  RetentionIntents
> = (_state, ctx) => ({
  state: {},
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
