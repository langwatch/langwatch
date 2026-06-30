/**
 * ADR-034: live dataset-processing progress — the shared event shape + the two
 * broadcast seams, kept out of both the normalize job (so it stays decoupled
 * from `BroadcastService`/tRPC and unit-testable at its boundaries) and the
 * tRPC router (so the router stays a thin relay).
 *
 * Progress is **ephemeral**: it is broadcast over the existing export SSE spine
 * and never persisted. Durability of the *terminal* outcome is ADR-032's
 * `Dataset.status`; the client reconciles it via `getById` (the bar can never
 * hang — I-TERMINAL-REACHED). These helpers only carry the live ticks + a
 * best-effort terminal nudge.
 */
import { z } from "zod";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";

/** The tenant-emitter / Redis channel event name (see `BroadcastEventType`). */
export const DATASET_PROGRESS_EVENT = "dataset_progress" as const;

/**
 * Producer-side minimum interval between throttled `progress` broadcasts
 * (ADR-034 I-RATE). The shared rate limiter is a token bucket (200/s sustained),
 * NOT a min-interval throttle, so a 2 GB file's ~128 chunk flushes would all
 * sail through unsmoothed — the producer enforces the floor itself via a
 * last-sent timestamp. Terminal events bypass this entirely.
 */
export const DATASET_PROGRESS_BROADCAST_MIN_INTERVAL_MS = 1000;

/**
 * Client-side gap (no SSE event while `processing`) after which the client
 * re-fetches `getById` to reconcile the terminal state (ADR-034 Decision 4
 * safety timer). Exported for the client hook; lives here so the two intervals
 * sit together.
 */
export const DATASET_PROGRESS_STALE_RECONCILE_MS = 5000;

export const datasetProgressEventSchema = z.object({
  datasetId: z.string(),
  type: z.enum(["progress", "done", "error"]),
  phase: z
    .enum(["uploading", "processing", "finalizing", "ready", "failed"])
    .optional(),
  /** Bytes read from the staged INPUT stream (numerator). */
  bytesRead: z.number().optional(),
  /** Staged-object HEAD size at job start (denominator) — NOT the output `sizeBytes`. */
  totalBytes: z.number().optional(),
  /** Unbounded live row count (no denominator). */
  rows: z.number().optional(),
  /** Generic failure message on `type: "error"`. */
  message: z.string().optional(),
});

export type DatasetProgressEvent = z.infer<typeof datasetProgressEventSchema>;

/**
 * The emit seam the normalize job is handed (kept narrow so the job never sees
 * `BroadcastService`). `progress` ticks may be dropped under load; the terminal
 * event is the only one that matters for correctness, and even it is only a
 * best-effort nudge — `getById` reconciliation is the guarantee.
 */
export type EmitDatasetProgress = (
  projectId: string,
  event: DatasetProgressEvent,
) => void;

/**
 * Build the emit seam over a `BroadcastService`. `progress` goes through the
 * rate-limited path (safe to drop — the next tick recovers); terminal
 * `done`/`error` goes through the PLAIN path so the limiter can't strand the bar
 * at 99% (ADR-034 Decision 5). Both are fire-and-forget — a publish failure must
 * never fail a normalize.
 */
export const makeEmitDatasetProgress =
  (broadcast: BroadcastService): EmitDatasetProgress =>
  (projectId, event) => {
    const payload = JSON.stringify(event);
    if (event.type === "progress") {
      void broadcast
        .broadcastToTenantRateLimited(projectId, payload, DATASET_PROGRESS_EVENT)
        .catch(() => undefined);
    } else {
      void broadcast
        .broadcastToTenant(projectId, payload, DATASET_PROGRESS_EVENT)
        .catch(() => undefined);
    }
  };
