/** Projection replay vocabulary: port could only return Promise<unknown>,
 * leaving all field reads type-unchecked on the client. */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Where a replay run is, right now. There is at most one at a time. */
const replayStatusSchemaDefinition = z.object({
  state: z.enum(["idle", "running", "completed", "failed", "cancelled"]),
  runId: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  projectionNames: z.array(z.string()),
  since: z.string(),
  tenantIds: z.array(z.string()),
  currentProjection: z.string().nullable(),
  currentPhase: z.string().nullable(),
  aggregatesProcessed: z.number(),
  aggregatesTotal: z.number(),
  eventsProcessed: z.number(),
  error: z.string().nullable(),
  description: z.string().nullable(),
  userName: z.string().nullable(),
});
export interface ReplayStatusSchema extends Named<typeof replayStatusSchemaDefinition> {}
export const replayStatusSchema: ReplayStatusSchema = replayStatusSchemaDefinition;
export type ReplayStatus = z.infer<typeof replayStatusSchema>;

/** A finished run, as the history keeps it. `idle` and `running` cannot appear. */
const replayHistoryEntrySchemaDefinition = z.object({
  runId: z.string(),
  projectionNames: z.array(z.string()),
  since: z.string(),
  tenantIds: z.array(z.string()),
  description: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  state: z.enum(["completed", "failed", "cancelled"]),
  userName: z.string(),
  aggregatesProcessed: z.number(),
  eventsProcessed: z.number(),
  error: z.string().nullable().optional(),
});
export interface ReplayHistoryEntrySchema extends Named<
  typeof replayHistoryEntrySchemaDefinition
> {}
export const replayHistoryEntrySchema: ReplayHistoryEntrySchema =
  replayHistoryEntrySchemaDefinition;
export type ReplayHistoryEntry = z.infer<typeof replayHistoryEntrySchema>;

/**
 * One page of the retained history, newest first. The cursor is the run id of the page's last
 * entry, so a run prepended between two reads never shifts what the next page returns.
 */
const replayHistoryPageInputSchemaDefinition = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export interface ReplayHistoryPageInputSchema extends Named<
  typeof replayHistoryPageInputSchemaDefinition
> {}
export const replayHistoryPageInputSchema: ReplayHistoryPageInputSchema =
  replayHistoryPageInputSchemaDefinition;
export type ReplayHistoryPageInput = z.infer<typeof replayHistoryPageInputSchema>;

/**
 * `cursor_expired` means the run the cursor names has left the retained history (the list keeps
 * only the newest runs): the reader restarts from the first page.
 */
const replayHistoryPageSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("page"),
    entries: replayHistoryEntrySchema.array(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
  z.object({ outcome: z.literal("cursor_expired") }),
]);
export interface ReplayHistoryPageSchema extends Named<typeof replayHistoryPageSchemaDefinition> {}
export const replayHistoryPageSchema: ReplayHistoryPageSchema = replayHistoryPageSchemaDefinition;
export type ReplayHistoryPage = z.infer<typeof replayHistoryPageSchema>;

/** The answer when nothing has ever run, and the shape a lost status falls back to. */
export const IDLE_STATUS: ReplayStatus = {
  state: "idle",
  runId: null,
  startedAt: null,
  completedAt: null,
  projectionNames: [],
  since: "",
  tenantIds: [],
  currentProjection: null,
  currentPhase: null,
  aggregatesProcessed: 0,
  aggregatesTotal: 0,
  eventsProcessed: 0,
  error: null,
  description: null,
  userName: null,
};
