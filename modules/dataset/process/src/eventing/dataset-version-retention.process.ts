import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const DATASET_VERSION_RETENTION_PROCESS_NAME = "datasetVersionRetention" as const;

/** How often the retention sweep walks every dataset's history. */
export const DATASET_VERSION_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const datasetVersionRetentionStateSchema = z.object({ lastSweepAt: z.number().nullable() });
type DatasetVersionRetentionState = z.infer<typeof datasetVersionRetentionStateSchema>;

export const datasetVersionRetentionIntentSchema = z.object({ scheduledFor: z.number().int() });

type RetentionIntents = { sweep: IntentSpec<typeof datasetVersionRetentionIntentSchema> };

export const datasetVersionRetentionWake: WakeHandler<
  DatasetVersionRetentionState,
  RetentionIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
