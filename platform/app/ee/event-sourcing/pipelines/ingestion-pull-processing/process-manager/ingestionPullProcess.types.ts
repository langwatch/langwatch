import { z } from "zod";

export const INGESTION_PULL_PROCESS_NAME = "ingestionPull";

export const ingestionPullRunIntentSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  scheduledFor: z.number(),
  cursor: z.string().nullable(),
});
export type IngestionPullRunIntent = z.infer<
  typeof ingestionPullRunIntentSchema
>;

export const ingestionPullProcessStateSchema = z.object({
  sourceId: z.string(),
  enabled: z.boolean(),
  cron: z.string().nullable(),
  cursor: z.string().nullable(),
  currentRun: z
    .object({
      runId: z.string(),
      scheduledFor: z.number(),
      startedAt: z.number(),
    })
    .nullable(),
});
export type IngestionPullProcessState = z.infer<
  typeof ingestionPullProcessStateSchema
>;

export function initIngestionPullProcessState(): IngestionPullProcessState {
  return {
    sourceId: "",
    enabled: false,
    cron: null,
    cursor: null,
    currentRun: null,
  };
}
