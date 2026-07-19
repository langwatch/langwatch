import { z } from "zod";

export const INGESTION_PULL_PROCESS_NAME = "ingestionPull" as const;
export const INGESTION_PULL_INTENT_TYPE = "ingestion_pull.run" as const;

export const ingestionPullRunIntentSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  scheduledFor: z.number(),
  cursor: z.string().nullable(),
});
export type IngestionPullRunIntent = z.infer<
  typeof ingestionPullRunIntentSchema
>;

export interface IngestionPullProcessState {
  sourceId: string;
  enabled: boolean;
  cron: string | null;
  cursor: string | null;
  currentRun: {
    runId: string;
    scheduledFor: number;
    startedAt: number;
  } | null;
}

export const ingestionPullProcessEventViewSchema = z.object({
  sourceId: z.string(),
  cron: z.string().nullable(),
  cursor: z.string().nullable(),
  runId: z.string().nullable(),
});
