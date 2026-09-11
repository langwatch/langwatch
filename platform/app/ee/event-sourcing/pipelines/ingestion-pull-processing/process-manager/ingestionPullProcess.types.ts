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
  /** List the source's people once, for one request. */
  LIST_PEOPLE: "listPeople",
} as const;

export const ingestionPullRunIntentSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  scheduledFor: z.number(),
  cursor: z.string().nullable(),
  /**
   * The run this one is replacing, when it starts by taking over from a run
   * that outlived its allowance.
   *
   * Carried on the intent rather than recorded by the process, because only
   * one of them may write: a process handler emits intents and the executor
   * owns the commands. The executor knows both ids, so it can record the
   * abandonment naming its replacement, which a separate intent could not do
   * without inventing a second way for a run to end.
   */
  abandonedRunId: z.string().optional(),
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
 *
 * ONE schema for both listings. Which list was asked for is the intent's own
 * type, so putting it in the payload as well would be a second place to keep
 * it, and a second place for the two to disagree.
 */
export const ingestionPullListingIntentSchema = z.object({
  sourceId: z.string(),
  requestId: z.string(),
  requestedAt: z.number(),
});
export type IngestionPullListingIntent = z.infer<
  typeof ingestionPullListingIntentSchema
>;

/** The intents this process may emit; typed so handlers get `ctx.intents.run`. */
export type IngestionPullIntents = {
  [INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]: IntentSpec<
    typeof ingestionPullRunIntentSchema
  >;
  [INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_AGENTS]: IntentSpec<
    typeof ingestionPullListingIntentSchema
  >;
  [INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_PEOPLE]: IntentSpec<
    typeof ingestionPullListingIntentSchema
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
  /**
   * The people listing in flight, if any. Tracked SEPARATELY from the agent
   * one rather than sharing a slot: the two ask different providers different
   * questions, and one in flight is no reason to refuse the other.
   */
  currentPeopleListing?: {
    requestId: string;
    startedAt: number;
  } | null;
  /**
   * The instant this connection may ask its provider again, epoch ms, when a
   * provider has asked it to wait.
   *
   * On the connection rather than on the run that was told, which is the
   * whole correction: a run replaced mid-wait used to take the wait with it,
   * and its replacement went straight back to a provider that had just said
   * no. Held here, the wait outlives the attempt that received it.
   *
   * Absent on every state written before cooldowns existed, so readers treat
   * absence as "no wait" — right for that history, where none was recorded.
   */
  cooldownUntil?: number | null;
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
  /**
   * A length of time a provider asked for, in milliseconds — never a payload,
   * and never a figure of ours. Defaulted to null for the same reason
   * `requestId` is: events written before cooldowns existed carry no such key,
   * and no key means no wait was named.
   *
   * Deliberately NOT validated as positive or bounded here. The view's job is
   * to carry what the event said across the content boundary; deciding that a
   * provider's answer is unreadable, or too long to honour, belongs to the one
   * place that turns it into an instant, so there is one rule and not two.
   *
   * `catch` rather than a bare parse, and it is the whole scenario: this value
   * originates in a provider's answer, and a strange one used to be handed
   * straight to the part that works out the next run, which rejects what it
   * cannot read. Evolve re-runs a committed event on every retry, so throwing
   * here would poison the subscriber forever — one provider answering strangely
   * would stop every scheduled connection, not the one it answered. Anything
   * unreadable degrades to no wait at all.
   */
  retryAfterMs: z.number().nullable().catch(null),
});
export type IngestionPullProcessEventView = z.infer<
  typeof ingestionPullProcessEventViewSchema
>;
