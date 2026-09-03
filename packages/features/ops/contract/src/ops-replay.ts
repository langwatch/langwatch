/**
 * What a projection replay is, as every door reads it.
 *
 * The vocabulary was in `platform/app`, so the port the operator transport
 * calls could only say `Promise<unknown>` — and `unknown` reaches the browser
 * as `{}`. Every field the replay drawer, the history table and the status
 * banner read was therefore unchecked: forty-one reads in the drawer alone
 * were type errors that a running page happened to satisfy.
 */

/** Where a replay run is, right now. There is at most one at a time. */
export interface ReplayStatus {
  state: "idle" | "running" | "completed" | "failed" | "cancelled";
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  projectionNames: string[];
  since: string;
  tenantIds: string[];
  currentProjection: string | null;
  currentPhase: string | null;
  aggregatesProcessed: number;
  aggregatesTotal: number;
  eventsProcessed: number;
  error: string | null;
  description: string | null;
  userName: string | null;
}

/** A finished run, as the history keeps it. `idle` and `running` cannot appear. */
export interface ReplayHistoryEntry {
  runId: string;
  projectionNames: string[];
  since: string;
  tenantIds: string[];
  description: string;
  startedAt: string;
  completedAt: string | null;
  state: "completed" | "failed" | "cancelled";
  userName: string;
  aggregatesProcessed: number;
  eventsProcessed: number;
  error?: string | null;
}

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
