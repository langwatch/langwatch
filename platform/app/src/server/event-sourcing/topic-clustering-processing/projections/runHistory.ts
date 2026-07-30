import { z } from "zod";
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
 * `topicClusteringRunHistory` — the project's recent runs, newest first,
 * bounded, one entry per run (specs/topic-clustering/run-history.feature).
 *
 * Each run's counts live under its own key and "abandoned" is derived at read
 * time — a running entry reads as abandoned whenever a higher-ranked run
 * exists — so there is no settling pass to race. Eviction compares by rank, so
 * the surviving set is a function of the population, not of arrival order.
 */

const runHistoryEntrySchema = z.object({
  runId: z.string(),
  /** Traces processed, keyed by the page that processed them. */
  pages: z.record(z.string(), z.number()),
  terminal: z
    .object({
      failed: z.boolean(),
      finishedAt: z.number(),
      mode: topicClusteringRunModeSchema.nullable(),
      skippedReason: topicClusteringSkipReasonSchema.nullable(),
      /** Customer-safe classification only — the raw error text belongs to the
       * run-status projection, which operators read. */
      errorCode: z.string().nullable(),
      isErrorUserActionable: z.boolean(),
      topicsCount: z.number(),
      subtopicsCount: z.number(),
    })
    .nullable(),
});
export type RunHistoryEntry = z.infer<typeof runHistoryEntrySchema>;

export const runHistoryStateSchema = z.object({
  runs: z.record(z.string(), runHistoryEntrySchema),
});
export type RunHistoryState = z.infer<typeof runHistoryStateSchema>;

/** How many runs the read model keeps per project. */
export const RUN_HISTORY_LIMIT = 50;

export function initRunHistoryState(): RunHistoryState {
  return { runs: {} };
}

function openEntry(runId: string): RunHistoryEntry {
  return { runId, pages: {}, terminal: null };
}

function tracesProcessed(pages: Record<string, number>): number {
  return Object.values(pages).reduce((total, traces) => total + traces, 0);
}

/** Keeps the highest-ranked {@link RUN_HISTORY_LIMIT} runs. An unrankable id
 * ranks below every rankable peer, so eviction stays total over malformed
 * input without ever preferring one. */
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
  return {
    ...state,
    runs: evictToLimit({ ...state.runs, [runId]: mutate(existing) }),
  };
}

/** Opens the entry on its first observed announcement; later pages of the same
 * run leave it alone. */
export function handleRunStarted(
  state: RunHistoryState,
  data: RunStartedData,
): RunHistoryState {
  return withRun(state, data.runId, (entry) => entry);
}

export function handleRunCompleted(
  state: RunHistoryState,
  data: RunCompletedData,
): RunHistoryState {
  return withRun(state, data.runId, (entry) => {
    const pages = { ...entry.pages, [data.page]: data.tracesProcessed };
    if (data.nextSearchAfter !== undefined) return { ...entry, pages };
    return {
      ...entry,
      pages,
      terminal: entry.terminal ?? {
        failed: false,
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
}

export function handleRunFailed(
  state: RunHistoryState,
  data: RunFailedData,
): RunHistoryState {
  return withRun(state, data.runId, (entry) => ({
    ...entry,
    terminal: entry.terminal ?? {
      failed: true,
      finishedAt: data.occurredAt,
      mode: null,
      skippedReason: null,
      errorCode: data.errorCode ?? null,
      isErrorUserActionable: data.isUserActionable ?? false,
      // A failed run produced no usable counts, and history must never disagree
      // with status about the same run.
      topicsCount: 0,
      subtopicsCount: 0,
    },
  }));
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
  /** The run id's own minted instant, not separately tracked state. */
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

function outcomeOf(
  entry: RunHistoryEntry,
  traces: number,
  isSuperseded: boolean,
): RunHistoryOutcome {
  const terminal = entry.terminal;
  if (!terminal) return isSuperseded ? "abandoned" : "running";
  if (terminal.failed) return "failed";
  return terminal.skippedReason !== null && traces === 0
    ? "skipped"
    : "completed";
}

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
      const traces = tracesProcessed(entry.pages);
      const failed = entry.terminal?.failed === true;
      return {
        runId: entry.runId,
        trigger: isManualRun(entry.runId) ? "manual" : "scheduled",
        startedAt: rank,
        finishedAt: entry.terminal?.finishedAt ?? null,
        outcome: outcomeOf(entry, traces, rank !== null && rank < highestRank),
        mode: entry.terminal?.mode ?? null,
        skippedReason: entry.terminal?.skippedReason ?? null,
        errorCode: entry.terminal?.errorCode ?? null,
        isErrorUserActionable: entry.terminal?.isErrorUserActionable ?? false,
        tracesProcessed: failed ? 0 : traces,
        topicsCount: failed ? 0 : (entry.terminal?.topicsCount ?? 0),
        subtopicsCount: failed ? 0 : (entry.terminal?.subtopicsCount ?? 0),
        pages: failed ? 0 : Object.keys(entry.pages).length,
      };
    })
    .sort((a, b) => (b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity))
    .slice(0, RUN_HISTORY_LIMIT);
}
