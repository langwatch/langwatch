/** Projection replay vocabulary: port could only return Promise<unknown>,
 * leaving all field reads type-unchecked on the client. */

import { z } from "zod";

/** Where a replay run is, right now. There is at most one at a time. */
export const replayStatusSchema = z.object({
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
export type ReplayStatus = z.infer<typeof replayStatusSchema>;

/** A finished run, as the history keeps it. `idle` and `running` cannot appear. */
export const replayHistoryEntrySchema = z.object({
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
export type ReplayHistoryEntry = z.infer<typeof replayHistoryEntrySchema>;

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
