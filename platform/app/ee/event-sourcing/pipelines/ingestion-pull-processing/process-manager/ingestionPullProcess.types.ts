import { z } from "zod";

import type { IntentSpec } from "~/server/event-sourcing/pipeline/processManagerDefinition";

export const INGESTION_PULL_PROCESS_NAME = "ingestionPull";

export const INGESTION_PULL_PROCESS_INTENT_TYPES = {
  /**
   * Run one pull attempt for the source from its durable cursor.
   * Property-style like the other builder-mounted domains
   * (`ctx.intents.run(...)`); outbox rows scope intentType by processName,
   * so the short name stays unambiguous.
   */
  RUN: "run",
} as const;

export const ingestionPullRunIntentSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  scheduledFor: z.number(),
  cursor: z.string().nullable(),
});
export type IngestionPullRunIntent = z.infer<
  typeof ingestionPullRunIntentSchema
>;

/** The intents this process may emit; typed so handlers get `ctx.intents.run`. */
export type IngestionPullIntents = {
  [INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]: IntentSpec<
    typeof ingestionPullRunIntentSchema
  >;
};

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

/**
 * The content-stripped view of a pipeline event the process consumes
 * (ADR-052 content boundary). Pull events carry provider payload counts and
 * cursors, never customer content, but the boundary keeps the same shape
 * discipline as the other process managers.
 */
export const ingestionPullProcessEventViewSchema = z.object({
  sourceId: z.string(),
  cron: z.string().nullable(),
  cursor: z.string().nullable(),
  runId: z.string().nullable(),
});
export type IngestionPullProcessEventView = z.infer<
  typeof ingestionPullProcessEventViewSchema
>;
