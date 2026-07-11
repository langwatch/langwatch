import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";

/**
 * One model call's token composition, in the order it happened.
 *
 * The session fold (ADR-040) only ever carries the SUM across a whole
 * session — `cacheReadTokens`, `cacheCreationTokens` as two scalars. That
 * answers "how much did this session reuse vs rebuild in total", but not
 * "where" — which call, at what point in the conversation, spent the money.
 * This is the per-call breakdown that answers that, built client-side from
 * spans the drawer already reads, rather than growing the bounded fold with
 * an array that scales with session length.
 */
export interface TokenTimelinePoint {
  index: number;
  atMs: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export function deriveTokenTimeline(entries: TranscriptEntry[]): TokenTimelinePoint[] {
  const points: TokenTimelinePoint[] = [];
  for (const entry of entries) {
    if (entry.kind !== "model_call") continue;
    points.push({
      index: points.length,
      atMs: entry.atMs,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
      costUsd: entry.costUsd,
    });
  }
  return points;
}

/** A call that re-created most of the context instead of reading it from cache. */
export interface CacheRebuildEvent {
  atMs: number;
  cacheCreationTokens: number;
  /** The context size the PREVIOUS call had cached, for the "instead of reusing N" comparison. */
  previousContextTokens: number;
  /** The nearest user message before this call — usually what caused the rebuild. */
  precedingPrompt: string | null;
}

/**
 * A cache write costs MORE than a read, so a call whose `cacheCreationTokens`
 * is close to the size of the context the PREVIOUS call had cached is the
 * session paying twice for the same tokens. The first call is never flagged —
 * there is nothing to reuse yet, so a cold cache isn't a rebuild.
 */
const REBUILD_RATIO_THRESHOLD = 0.5;
const REBUILD_MIN_TOKENS = 1_000;

export function findCacheRebuilds(entries: TranscriptEntry[]): CacheRebuildEvent[] {
  const events: CacheRebuildEvent[] = [];
  let previousContextTokens = 0;
  let sawFirstCall = false;

  for (const entry of entries) {
    if (entry.kind !== "model_call") continue;
    const contextTokens = entry.cacheReadTokens + entry.cacheCreationTokens;

    if (
      sawFirstCall &&
      entry.cacheCreationTokens >= REBUILD_MIN_TOKENS &&
      previousContextTokens > 0 &&
      entry.cacheCreationTokens / previousContextTokens >= REBUILD_RATIO_THRESHOLD
    ) {
      events.push({
        atMs: entry.atMs,
        cacheCreationTokens: entry.cacheCreationTokens,
        previousContextTokens,
        precedingPrompt: nearestPrecedingPrompt(entries, entry.atMs),
      });
    }

    sawFirstCall = true;
    previousContextTokens = contextTokens;
  }

  return events;
}

function nearestPrecedingPrompt(entries: TranscriptEntry[], atMs: number): string | null {
  let best: string | null = null;
  for (const entry of entries) {
    if (entry.atMs > atMs) break;
    if (entry.kind === "user_prompt" && entry.text?.trim()) best = entry.text;
  }
  return best;
}
