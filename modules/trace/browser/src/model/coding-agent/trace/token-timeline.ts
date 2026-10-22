import {
  isCacheRebuild,
  splitLeadingContextBlocks,
  type TranscriptEntry,
} from "@langwatch/coding-agent-contract";

/**
 * Per-call token composition from spans; answers "where" (not just "how much")
 * tokens spent (session fold only gives totals).
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

type ModelCall = Extract<TranscriptEntry, { kind: "model_call" }>;

/** What a call read from or wrote to the cache: what the next call can reuse. */
export function modelCallCachedTokens(entry: ModelCall): number {
  return entry.cacheReadTokens + entry.cacheCreationTokens;
}

/** A call's context: the whole prompt it sent. Input arrives disjoint from the cache. */
export function modelCallContextTokens(entry: ModelCall): number {
  return entry.inputTokens + modelCallCachedTokens(entry);
}

/** A call that re-created most of the context instead of reading it from cache. */
export interface CacheRebuildEvent {
  /**
   * Zero-based position among the session's model calls — matches
   * {@link TokenTimelinePoint.index}, so chart and annotation name same call.
   */
  callIndex: number;
  atMs: number;
  cacheCreationTokens: number;
  /** The whole prompt the PREVIOUS call sent, which the rebuild is measured against. */
  previousContextTokens: number;
  /** What the PREVIOUS call left in the cache (read plus written), shown as "reusing N cached". */
  previousCachedTokens: number;
  /** The nearest user message before this call — usually what caused the rebuild. */
  precedingPrompt: string | null;
}

/** The first call is never flagged: a cold cache isn't a rebuild. */
export function findCacheRebuilds(entries: TranscriptEntry[]): CacheRebuildEvent[] {
  const events: CacheRebuildEvent[] = [];
  let previousContextTokens = 0;
  let previousCachedTokens = 0;
  let callIndex = -1;

  for (const entry of entries) {
    if (entry.kind !== "model_call") continue;
    callIndex++;
    const cachedTokens = modelCallCachedTokens(entry);
    const contextTokens = modelCallContextTokens(entry);

    if (
      callIndex > 0 &&
      isCacheRebuild({
        previousContextTokens,
        previousCachedTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheCreationTokens: entry.cacheCreationTokens,
      })
    ) {
      events.push({
        callIndex,
        atMs: entry.atMs,
        cacheCreationTokens: entry.cacheCreationTokens,
        previousContextTokens,
        previousCachedTokens,
        precedingPrompt: nearestPrecedingPrompt(entries, entry.atMs),
      });
    }

    previousContextTokens = contextTokens;
    previousCachedTokens = cachedTokens;
  }

  return events;
}

/** Quoted by the user's own words: leading context blocks (Copilot's date) peel off. */
function nearestPrecedingPrompt(entries: TranscriptEntry[], atMs: number): string | null {
  let best: string | null = null;
  for (const entry of entries) {
    if (entry.atMs > atMs) break;
    if (entry.kind === "user_prompt" && entry.text?.trim()) best = entry.text;
  }
  if (best === null) return null;
  // A message that is only context blocks is left as written, as the Conversation tab does.
  return splitLeadingContextBlocks(best).body || best;
}
