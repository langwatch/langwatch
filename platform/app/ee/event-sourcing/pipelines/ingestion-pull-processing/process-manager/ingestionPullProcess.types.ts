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
  /** List the source's agents once, for one request. */
  LIST_AGENTS: "listAgents",
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

/**
 * Carries no cursor: a listing is a question about the present, not a window
 * to resume, so there is nothing durable for it to advance. It also carries
 * no organization id — the executor's port resolves that from the source, the
 * same way the pull's port does, which keeps tenancy out of the process state
 * and out of the content boundary.
 */
export const ingestionPullAgentListingIntentSchema = z.object({
  sourceId: z.string(),
  requestId: z.string(),
  requestedAt: z.number(),
});
export type IngestionPullAgentListingIntent = z.infer<
  typeof ingestionPullAgentListingIntentSchema
>;

/** The intents this process may emit; typed so handlers get `ctx.intents.run`. */
export type IngestionPullIntents = {
  [INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]: IntentSpec<
    typeof ingestionPullRunIntentSchema
  >;
  [INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_AGENTS]: IntentSpec<
    typeof ingestionPullAgentListingIntentSchema
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
  /**
   * The listing in flight, if any. Present so a second request arriving while
   * one is still running is dropped rather than spending another provider
   * call: an admin pressing a button twice means "did that work", not "ask
   * twice". Absent on every state written before listings existed, so the
   * handlers read it as optional.
   */
  currentAgentsListing?: {
    requestId: string;
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
  /**
   * An identity, like `runId` — never a provider payload.
   *
   * Defaulted rather than required, unlike its siblings: those have been in
   * the view since the first event, and this one has not. A payload built
   * before listings existed carries no such key, and reading its absence as
   * "no request" is right for that history — there were no requests to name.
   */
  requestId: z.string().nullable().default(null),
});
export type IngestionPullProcessEventView = z.infer<
  typeof ingestionPullProcessEventViewSchema
>;
