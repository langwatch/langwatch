import type { AggregateEvent } from "@langwatch/event-sourcing";
import { z } from "zod";
import {
  type TopicClusteringEventKey,
  topicClusteringEventKeyOf,
} from "../aggregate";
import { isManualRun, runRank } from "../runIdentity";
import {
  type RunCompletedData,
  type RunFailedData,
  type RunStartedData,
  type TopicClusteringRunMode,
  type TopicClusteringSkipReason,
  topicClusteringRunModeSchema,
  topicClusteringSkipReasonSchema,
} from "../schema";

/**
 * `topicClusteringRunHistory` — the audit read model behind
 * `specs/topic-clustering/run-history.feature`: the project's recent runs,
 * newest first, bounded, one entry per logical run.
 *
 * === Why this state shape differs from the old fold ===
 *
 * The old fold stored an ordered array and, on every event, ran
 * `settleSuperseded`: any entry still reading "running" other than the one
 * the current event belongs to was rewritten to "abandoned" *as a state
 * mutation*, immediately. That mutation is order-dependent — verified by
 * hand against the old code, not merely asserted: applying run A's page then
 * run B's page settles A as abandoned and opens B as running; applying B's
 * page then A's page settles B as abandoned and opens A as running. Two
 * orderings of the SAME two events reach two DIFFERENT final states, which
 * is exactly the property ADR-098 decision 4 forbids.
 *
 * This fold instead stores each run's raw, order-invariant facts — keyed by
 * run id, each accumulated independently — and computes "abandoned" as a
 * DERIVED property at read time ({@link deriveRunHistoryView}): a running
 * entry reads as abandoned whenever a run with a strictly higher rank also
 * exists in the map, never as a value written into the entry itself. There
 * is no mutation to race, because there is nothing to settle.
 *
 * === Field-by-field order-invariance classification (ADR-098 decision 4) ===
 *
 * - `runs` (the map's key set) — **commutative**: inserting a new key for a
 *   run id no one has seen before does not depend on what else is in the
 *   map.
 * - `runs[id].tracesProcessed` / `.pagesSeen` — **commutative and
 *   associative**, same reasoning as the run-status fold: a sum/count over
 *   DISTINCT page events for one run id.
 * - `runs[id].terminal` — **monotone "sticky-once"**, same shape and same
 *   documented exception as `runStatus.ts`'s `currentRunTerminal` (a run
 *   reporting both a completion and a failure is an operational
 *   impossibility this fold does not itself enforce).
 * - **the bounded population** (keeping only the highest-ranked
 *   `RUN_HISTORY_LIMIT` runs) — an order-invariant reduction: after every
 *   event in a given SET has been applied, eviction keeps exactly the
 *   top-`LIMIT` runs by rank regardless of the order they arrived in,
 *   because eviction always compares by rank, never by insertion order.
 *   (An intermediate state, mid-delivery, can differ transiently — that is
 *   expected and is not what order-invariance is about; see
 *   `orderInvariance.ts`'s own contract, which compares FINAL states after
 *   the full event SET has applied in each ordering.)
 * - **"abandoned" vs. "running"** — not stored at all; a pure function of
 *   "does a run with a strictly higher rank than mine also exist in the
 *   map", computed identically regardless of arrival order once the same
 *   set of runs is known.
 */

export interface RunHistoryEntry {
  readonly runId: string;
  readonly tracesProcessed: number;
  readonly pagesSeen: number;
  readonly terminal: {
    readonly outcome: "completed" | "skipped" | "failed";
    readonly finishedAt: number;
    readonly mode: TopicClusteringRunMode | null;
    readonly skippedReason: TopicClusteringSkipReason | null;
    /** Customer-safe classification only — the raw error text is
     * deliberately NOT part of this read model
     * (`specs/topic-clustering/run-history.feature`: "A failed run keeps
     * its guidance without raw error detail"); it lives in the run-status
     * projection for operators (`runStatus.ts`'s `TerminalOutcome.errorMessage`). */
    readonly errorCode: string | null;
    readonly isErrorUserActionable: boolean;
    readonly topicsCount: number;
    readonly subtopicsCount: number;
  } | null;
}

const runHistoryEntrySchema: z.ZodType<RunHistoryEntry> = z.object({
  runId: z.string(),
  tracesProcessed: z.number(),
  pagesSeen: z.number(),
  terminal: z
    .object({
      outcome: z.enum(["completed", "skipped", "failed"]),
      finishedAt: z.number(),
      mode: topicClusteringRunModeSchema.nullable(),
      skippedReason: topicClusteringSkipReasonSchema.nullable(),
      errorCode: z.string().nullable(),
      isErrorUserActionable: z.boolean(),
      topicsCount: z.number(),
      subtopicsCount: z.number(),
    })
    .nullable(),
});

export const runHistoryStateSchema = z.object({
  runs: z.record(z.string(), runHistoryEntrySchema),
});
export type RunHistoryState = z.infer<typeof runHistoryStateSchema>;

/** How many runs the read model keeps per project (bounded population — see
 * the module docblock's classification of the eviction rule). */
export const RUN_HISTORY_LIMIT = 50;

export function initRunHistoryState(): RunHistoryState {
  return { runs: {} };
}

function openEntry(runId: string): RunHistoryEntry {
  return { runId, tracesProcessed: 0, pagesSeen: 0, terminal: null };
}

/** Keeps only the {@link RUN_HISTORY_LIMIT} highest-ranked runs, evicting by
 * rank rather than by insertion order so the surviving set is a pure
 * function of the population, not of arrival order. An unrankable run id
 * (see `runIdentity.ts`) is treated as rank `-Infinity` for eviction
 * purposes only — it can be evicted but is never preferred over a rankable
 * peer, which keeps eviction total even over malformed input. */
function evictToLimit(
  runs: Record<string, RunHistoryEntry>,
): Record<string, RunHistoryEntry> {
  const ids = Object.keys(runs);
  if (ids.length <= RUN_HISTORY_LIMIT) return runs;
  const ranked = ids
    .map((id) => ({ id, rank: runRank(id) ?? -Infinity }))
    .sort((a, b) => b.rank - a.rank || (a.id < b.id ? 1 : -1));
  const kept = new Set(ranked.slice(0, RUN_HISTORY_LIMIT).map((r) => r.id));
  const next: Record<string, RunHistoryEntry> = {};
  for (const id of ids) {
    if (kept.has(id)) next[id] = runs[id]!;
  }
  return next;
}

function withRun(
  state: RunHistoryState,
  runId: string,
  mutate: (entry: RunHistoryEntry) => RunHistoryEntry,
): RunHistoryState {
  const existing = state.runs[runId] ?? openEntry(runId);
  const runs = evictToLimit({ ...state.runs, [runId]: mutate(existing) });
  return { ...state, runs };
}

/**
 * Dispatch table keyed by {@link TopicClusteringEventKey} — see
 * `runStatus.ts`'s identical pattern and `aggregate.ts`'s
 * `topicClusteringEventKeyOf` docblock for why this replaces a
 * hand-reconstructed `` `topic_clustering/${key}` `` `switch`.
 */
type Handler = (state: RunHistoryState, data: unknown) => RunHistoryState;

const HANDLERS: Partial<Record<TopicClusteringEventKey, Handler>> = {
  runStarted: (state, rawData) => {
    const data = rawData as RunStartedData;
    // Opens the entry if this is its first observed announcement;
    // otherwise a no-op — later pages of the same run leave the
    // accumulating entry alone.
    return withRun(state, data.runId, (entry) => entry);
  },

  runCompleted: (state, rawData) => {
    const data = rawData as RunCompletedData;
    return withRun(state, data.runId, (entry) => {
      const tracesProcessed = entry.tracesProcessed + data.tracesProcessed;
      const pagesSeen = entry.pagesSeen + 1;
      const isTerminalPage = data.nextSearchAfter === undefined;
      if (!isTerminalPage) {
        return { ...entry, tracesProcessed, pagesSeen };
      }
      const skippedWithoutWork =
        data.skippedReason != null && tracesProcessed === 0;
      return {
        ...entry,
        tracesProcessed,
        pagesSeen,
        terminal: entry.terminal ?? {
          outcome: skippedWithoutWork ? "skipped" : "completed",
          finishedAt: data.occurredAt,
          mode: data.mode,
          skippedReason: data.skippedReason ?? null,
          errorCode: null,
          isErrorUserActionable: false,
          topicsCount: data.topicsCount,
          subtopicsCount: data.subtopicsCount,
        },
      };
    });
  },

  runFailed: (state, rawData) => {
    const data = rawData as RunFailedData;
    return withRun(state, data.runId, (entry) => ({
      ...entry,
      terminal: entry.terminal ?? {
        outcome: "failed",
        finishedAt: data.occurredAt,
        mode: null,
        skippedReason: null,
        errorCode: data.errorCode ?? null,
        isErrorUserActionable: data.isUserActionable ?? false,
        // Mirrors the run-status projection: a failed run produced no
        // usable counts, and history must never disagree with status
        // about the same run (old fold's own invariant, preserved).
        topicsCount: 0,
        subtopicsCount: 0,
      },
      // A failed run's traces/pages also read as zero in the view below,
      // via the same `outcome === "failed"` branch runStatus.ts uses —
      // the raw accumulation stays in `tracesProcessed`/`pagesSeen` for
      // symmetry with runStatus's state shape, and the VIEW is what
      // zeroes it.
    }));
  },
};

export function applyRunHistoryEvent(
  state: RunHistoryState,
  event: AggregateEvent,
): RunHistoryState {
  const key = topicClusteringEventKeyOf(event.type);
  const handler = key ? HANDLERS[key] : undefined;
  return handler ? handler(state, event.data) : state;
}

export type RunHistoryOutcome =
  | "running"
  | "abandoned"
  | "completed"
  | "skipped"
  | "failed";

export interface RunHistoryViewEntry {
  readonly runId: string;
  readonly trigger: "manual" | "scheduled";
  /** Derived from the run id's own minted instant — see `runIdentity.ts` —
   * rather than tracked as separate fold state. */
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly outcome: RunHistoryOutcome;
  readonly mode: TopicClusteringRunMode | null;
  readonly skippedReason: TopicClusteringSkipReason | null;
  readonly errorCode: string | null;
  readonly isErrorUserActionable: boolean;
  readonly tracesProcessed: number;
  readonly topicsCount: number;
  readonly subtopicsCount: number;
  readonly pages: number;
}

/**
 * The bounded, newest-first, abandonment-resolved view a settings page
 * reads (`specs/topic-clustering/run-history.feature`).
 */
export function deriveRunHistoryView(
  state: RunHistoryState,
): RunHistoryViewEntry[] {
  const entries = Object.values(state.runs);
  const highestRank = entries.reduce<number>((max, entry) => {
    const rank = runRank(entry.runId);
    return rank !== null && rank > max ? rank : max;
  }, -Infinity);

  return entries
    .map((entry): RunHistoryViewEntry => {
      const rank = runRank(entry.runId);
      const isSuperseded = rank !== null && rank < highestRank;
      const outcome: RunHistoryOutcome =
        entry.terminal?.outcome ?? (isSuperseded ? "abandoned" : "running");
      const failed = entry.terminal?.outcome === "failed";
      return {
        runId: entry.runId,
        trigger: isManualRun(entry.runId) ? "manual" : "scheduled",
        startedAt: rank,
        finishedAt: entry.terminal?.finishedAt ?? null,
        outcome,
        mode: entry.terminal?.mode ?? null,
        skippedReason: entry.terminal?.skippedReason ?? null,
        errorCode: entry.terminal?.errorCode ?? null,
        isErrorUserActionable: entry.terminal?.isErrorUserActionable ?? false,
        tracesProcessed: failed ? 0 : entry.tracesProcessed,
        topicsCount: failed ? 0 : (entry.terminal?.topicsCount ?? 0),
        subtopicsCount: failed ? 0 : (entry.terminal?.subtopicsCount ?? 0),
        pages: failed ? 0 : entry.pagesSeen,
      };
    })
    .sort((a, b) => (b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity))
    .slice(0, RUN_HISTORY_LIMIT);
}
