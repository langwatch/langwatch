/**
 * Wire shape of a cached fold state.
 *
 * The entry carries more than the state because releasing it safely needs two
 * extra facts:
 *
 * - `u` — the state's own `UpdatedAt`. The confirmation processor compares it
 *   against what the durable store reports on every replica; the entry is
 *   released only once the slowest replica has caught up to it.
 * - `e` — the ids of the events folded into this state. A queue redelivery
 *   re-applies the same events on top of state that already contains them, so
 *   the executor uses this set to recognise and skip them.
 *
 * Field names are single letters because this is written on every fold step
 * for every aggregate; for a 40k-span trace the key is rewritten ~80 times.
 */
export interface FoldCacheEntry<State> {
  /** Schema marker. Absent on entries written before durability gating. */
  v: 1;
  /** The fold state. */
  s: State;
  /** The state's UpdatedAt, in epoch ms. */
  u: number;
  /** Ids of events already folded into `s`, most recent last. */
  e: string[];
}

/**
 * How many event ids an entry carries.
 *
 * Redelivery re-dispatches the events of a single failed batch, so the set only
 * has to cover one batch to catch every duplicate. Sized to the fold coalesce
 * ceiling (`DEFAULT_FOLD_COALESCE_MAX_BATCH`) with headroom, and capped so a
 * long-lived aggregate cannot grow its entry without bound.
 */
export const MAX_APPLIED_EVENT_IDS = 1_000;

/**
 * Reads an entry written by `encodeFoldCacheEntry`, or a bare state written
 * before durability gating existed.
 *
 * Legacy entries yield a null `updatedAt` and an empty applied-set, which makes
 * them unconfirmable — the processor leaves them to the backstop TTL rather
 * than releasing something it cannot verify. They disappear within one backstop
 * period of the deploy.
 */
export function decodeFoldCacheEntry<State>(raw: string): {
  state: State;
  updatedAt: number | null;
  appliedEventIds: string[];
} {
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { v?: unknown }).v === 1
  ) {
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

  return merged.length > MAX_APPLIED_EVENT_IDS
    ? merged.slice(-MAX_APPLIED_EVENT_IDS)
    : merged;
}
