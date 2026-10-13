import { safeParseErrText } from "../../parseErrorText.ts";
// Wire shape of a cached fold state with event ids for dedup and timestamp
// for debugging; single-letter fields minimize writes on every fold step.
export interface FoldCacheEntry<State> {
  /** Schema marker. Absent on entries written before the applied-set existed. */
  v: 1;
  /** The fold state. */
  s: State;
  /** The state's UpdatedAt, in epoch ms. */
  u: number;
  /** Ids of events already folded into `s`, most recent last. */
  e: string[];
}

/**
 * How many event ids an entry carries. Redelivery re-dispatches a single
 * failed batch, so the set only needs to cover one batch; sized to the fold
 * coalesce ceiling with headroom, capped so a long-lived aggregate can't grow it unbounded.
 */
export const MAX_APPLIED_EVENT_IDS = 1_000;

/**
 * Reads an entry written by `encodeFoldCacheEntry`, or a bare state written
 * before durability gating existed. Legacy entries yield a null `updatedAt`
 * and an empty applied-set, so a redelivery against one is not suppressed.
 */
export class FoldCacheEntryUnreadableError extends Error {
  override readonly name = "FoldCacheEntryUnreadableError";
}

export function decodeFoldCacheEntry<State>(raw: string): {
  state: State;
  updatedAt: number | null;
  appliedEventIds: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // V8 quotes the offending input back in the message, and a cached fold
    // state is tenant data that would reach the job-failure log and the error
    // span attribute — exported to the observability backend, not just a log
    // file. `safeParseErrText` keeps the diagnosis and drops the echo (the
    // envelope decode path leaked exactly this, three attempts to close).
    throw new FoldCacheEntryUnreadableError(
      `Fold cache entry failed to parse: ${safeParseErrText(err)}`,
    );
  }

  if (typeof parsed === "object" && parsed !== null && (parsed as { v?: unknown }).v === 1) {
    const entry = parsed as FoldCacheEntry<State>;
    return {
      state: entry.s,
      updatedAt: entry.u,
      appliedEventIds: entry.e ?? [],
    };
  }

  return { state: parsed as State, updatedAt: null, appliedEventIds: [] };
}

export function encodeFoldCacheEntry<State>({
  state,
  updatedAt,
  appliedEventIds,
}: {
  state: State;
  updatedAt: number;
  appliedEventIds: readonly string[];
}): string {
  const trimmed =
    appliedEventIds.length > MAX_APPLIED_EVENT_IDS
      ? appliedEventIds.slice(-MAX_APPLIED_EVENT_IDS)
      : appliedEventIds;

  const entry: FoldCacheEntry<State> = {
    v: 1,
    s: state,
    u: updatedAt,
    e: [...trimmed],
  };
  return JSON.stringify(entry);
}

/**
 * Merges the ids applied by this fold step into the set already on the entry,
 * keeping the most recent `MAX_APPLIED_EVENT_IDS` and dropping duplicates.
 */
export function mergeAppliedEventIds({
  previous,
  applied,
}: {
  previous: readonly string[];
  applied: readonly string[];
}): string[] {
  if (applied.length === 0) return [...previous];

  const seen = new Set(applied);
  const kept = previous.filter((id) => !seen.has(id));
  const merged = [...kept, ...applied];

  return merged.length > MAX_APPLIED_EVENT_IDS ? merged.slice(-MAX_APPLIED_EVENT_IDS) : merged;
}
