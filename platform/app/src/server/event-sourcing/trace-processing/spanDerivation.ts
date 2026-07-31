import type { CanonicalSpan } from "./schema";

/**
 * Span-derivation helpers shared by `traceSummary.projection.ts` and
 * `traceAnalytics.projection.ts`.
 * Every function is commutative and idempotent — a lattice maximum, a set
 * union, or last-write-wins on a stamp our own boundary set (ADR-098 §4).
 */

/**
 * Past this many spans a trace is reported as oversized, so an evaluation
 * trigger can stop dispatching per-span work. Storage is never gated by it
 * (specs/trace-processing/oversized-trace-lighter-processing.feature).
 */
export const MAX_PROCESSED_SPANS = 512;

/** Never `localeCompare`: ICU collation inverts base62 KSUIDs at `Z` → `a`. */
export function isBytewiseSmaller(a: string, b: string): boolean {
  return a < b;
}

/** A trace's extent, held as `min(start)` and `max(end) - min(start)`. */
export interface TimeSpan {
  readonly startMs: number;
  readonly durationMs: number;
}

export function mergeTimeSpan(
  current: TimeSpan,
  span: { readonly startTimeUnixMs: number; readonly endTimeUnixMs: number },
): TimeSpan {
  if (
    !Number.isFinite(span.startTimeUnixMs) ||
    !Number.isFinite(span.endTimeUnixMs)
  ) {
    return current;
  }
  const startMs =
    current.startMs > 0
      ? Math.min(current.startMs, span.startTimeUnixMs)
      : span.startTimeUnixMs;
  const currentEnd =
    current.startMs > 0 ? current.startMs + current.durationMs : 0;
  return {
    startMs,
    durationMs: Math.max(currentEnd, span.endTimeUnixMs) - startMs,
  };
}

/** A value carrying the stamp our own boundary set when it was decided. */
export interface Stamped {
  readonly stamp: number;
  readonly value: string;
}

/**
 * Later stamp wins; an equal stamp is settled bytewise on the value itself, so
 * two decisions made in the same instant land the same way in either order.
 */
export function laterStampWins(current: Stamped, candidate: Stamped): boolean {
  if (candidate.stamp !== current.stamp) return candidate.stamp > current.stamp;
  return candidate.value > current.value;
}

/** One comparable value for the pair a topic assignment always sets together. */
export function topicKey(
  topicId: string | null,
  subTopicId: string | null,
): string {
  return `${topicId ?? ""}\u0000${subTopicId ?? ""}`;
}

/** Rank 3 (exception event) beats 2 (attribute) beats 1 (`statusMessage`). */
export type ErrorMessageRank = 1 | 2 | 3;

export interface ErrorMessageCandidate {
  readonly message: string;
  readonly rank: ErrorMessageRank;
  readonly spanId: string;
}

export function betterErrorMessage(
  current: ErrorMessageCandidate | null,
  candidate: ErrorMessageCandidate | null,
): ErrorMessageCandidate | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  if (candidate.rank !== current.rank) {
    return candidate.rank > current.rank ? candidate : current;
  }
  return isBytewiseSmaller(candidate.spanId, current.spanId)
    ? candidate
    : current;
}

/** Each model carries its latest-seen span start, so "primary" is a read-time sort. */
export type ModelUsage = Map<string, number>;

export function mergeModelUsage(
  state: ModelUsage,
  model: string,
  spanStartMs: number,
): ModelUsage {
  const existing = state.get(model);
  if (existing !== undefined && existing >= spanStartMs) return state;
  const next = new Map(state);
  next.set(model, spanStartMs);
  return next;
}

export function orderedModels(usage: ModelUsage): string[] {
  return [...usage.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([model]) => model);
}

/**
 * Root and fallback names are two running minimums over `(startTimeMs, spanId)`.
 * Which one is authoritative is a read-time decision.
 */
export interface NameCandidate {
  readonly spanId: string;
  readonly startTimeMs: number;
  readonly name: string;
  readonly spanType: string | null;
}

function isEarlierCandidate(a: NameCandidate, b: NameCandidate): boolean {
  if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs < b.startTimeMs;
  return isBytewiseSmaller(a.spanId, b.spanId);
}

export function mergeNameCandidate(
  current: NameCandidate | null,
  candidate: NameCandidate | null,
): NameCandidate | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  return isEarlierCandidate(candidate, current) ? candidate : current;
}

/**
 * 2 = root span, 1 = an explicit `langwatch.input`/`langwatch.output` match,
 * 0 = a non-semantic fallback. The maximum `(tier, endTimeMs, spanId)` wins.
 */
export type IOTier = 0 | 1 | 2;

export interface IOCandidate {
  readonly text: string;
  readonly tier: IOTier;
  readonly endTimeMs: number;
  readonly spanId: string;
}

export function betterIOCandidate(
  current: IOCandidate | null,
  candidate: IOCandidate | null,
): IOCandidate | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  if (candidate.tier !== current.tier) {
    return candidate.tier > current.tier ? candidate : current;
  }
  if (candidate.endTimeMs !== current.endTimeMs) {
    return candidate.endTimeMs > current.endTimeMs ? candidate : current;
  }
  return isBytewiseSmaller(candidate.spanId, current.spanId)
    ? candidate
    : current;
}

/** Rounding every step makes a sum order-dependent — float addition is not associative. */
export function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

export interface PromptCandidate {
  readonly promptId: string;
  readonly spanId: string;
  readonly startTimeMs: number;
}

/** Ordered by start time, ties broken on the bytewise-larger span id. */
export function isLaterPrompt(
  current: PromptCandidate | null,
  candidate: PromptCandidate,
): boolean {
  if (current === null) return true;
  if (candidate.startTimeMs !== current.startTimeMs) {
    return candidate.startTimeMs > current.startTimeMs;
  }
  return candidate.spanId > current.spanId;
}

/**
 * An annotation's presence is decided by two independent last-write-wins
 * records: the per-id change, and the newest whole-bucket sync. Whichever
 * carries the later `actedAt` — our own boundary's clock — decides, and on a
 * tie absence wins, so every combination settles the same way in either order.
 *
 * The sync is kept as a value rather than folded into the per-id map because
 * folding it would mean removing ids the fold happens to have seen, which is a
 * function of arrival order rather than of the events themselves.
 */
export interface AnnotationRecord {
  readonly present: boolean;
  readonly actedAt: number;
}

export interface AnnotationSync {
  readonly ids: string[];
  readonly actedAt: number;
}

export interface AnnotationState {
  readonly changes: Map<string, AnnotationRecord>;
  readonly sync: AnnotationSync | null;
}

export function emptyAnnotationState(): AnnotationState {
  return { changes: new Map(), sync: null };
}

export function applyAnnotationChange(
  state: AnnotationState,
  annotationId: string,
  present: boolean,
  actedAt: number,
): AnnotationState {
  const existing = state.changes.get(annotationId);
  if (existing !== undefined) {
    if (existing.actedAt > actedAt) return state;
    if (
      existing.actedAt === actedAt &&
      (existing.present === present || present)
    ) {
      return state;
    }
  }
  const changes = new Map(state.changes);
  changes.set(annotationId, { present, actedAt });
  return { changes, sync: state.sync };
}

export function applyAnnotationBulkSync(
  state: AnnotationState,
  annotationIds: readonly string[],
  actedAt: number,
): AnnotationState {
  const ids = [...new Set(annotationIds)].sort();
  const candidate: AnnotationSync = { ids, actedAt };
  if (
    state.sync !== null &&
    !laterStampWins(
      { stamp: state.sync.actedAt, value: state.sync.ids.join(" ") },
      { stamp: candidate.actedAt, value: ids.join(" ") },
    )
  ) {
    return state;
  }
  return { changes: state.changes, sync: candidate };
}

export function presentAnnotationIds(state: AnnotationState): string[] {
  const sync = state.sync;
  const candidates = new Set([...state.changes.keys(), ...(sync?.ids ?? [])]);
  const present: string[] = [];
  for (const id of candidates) {
    if (isAnnotationPresent(state, id)) present.push(id);
  }
  return present.sort();
}

function isAnnotationPresent(state: AnnotationState, id: string): boolean {
  const change = state.changes.get(id);
  const sync = state.sync;
  if (sync === null) return change?.present ?? false;
  const fromSync = sync.ids.includes(id);
  if (change === undefined) return fromSync;
  if (change.actedAt !== sync.actedAt) {
    return change.actedAt > sync.actedAt ? change.present : fromSync;
  }
  return change.present && fromSync;
}

/**
 * PII span ids are a set union capped at {@link MAX_TRACKED_PII_SPAN_IDS},
 * keeping the bytewise-smallest ids so the kept set is a function of the full
 * id set seen, never of arrival order.
 */
export const MAX_TRACKED_PII_SPAN_IDS = 1000;

export interface PIISpanIdSet {
  readonly ids: Set<string>;
  readonly overflowed: boolean;
}

export function emptyPIISpanIdSet(): PIISpanIdSet {
  return { ids: new Set(), overflowed: false };
}

export function addPIISpanId(
  state: PIISpanIdSet,
  spanId: string,
): PIISpanIdSet {
  if (state.ids.has(spanId)) return state;
  if (state.ids.size < MAX_TRACKED_PII_SPAN_IDS) {
    const next = new Set(state.ids);
    next.add(spanId);
    return { ids: next, overflowed: state.overflowed };
  }
  let largest: string | null = null;
  for (const id of state.ids) {
    if (largest === null || id > largest) largest = id;
  }
  if (largest !== null && isBytewiseSmaller(spanId, largest)) {
    const next = new Set(state.ids);
    next.delete(largest);
    next.add(spanId);
    return { ids: next, overflowed: true };
  }
  return { ids: state.ids, overflowed: true };
}

/**
 * Each attribute key's value is owned by the bytewise-smallest contributing
 * span id. A `metadata.*` value is one atomic value, never deep-merged.
 */
export interface AttributeOwner {
  readonly value: string;
  readonly spanId: string;
}
export type OwnedAttributeMap = Map<string, AttributeOwner>;

export function mergeAttribute(
  state: OwnedAttributeMap,
  key: string,
  value: string,
  spanId: string,
): OwnedAttributeMap {
  const existing = state.get(key);
  if (existing !== undefined && !isBytewiseSmaller(spanId, existing.spanId)) {
    return state;
  }
  const next = new Map(state);
  next.set(key, { value, spanId });
  return next;
}

export function attributeValues(
  state: OwnedAttributeMap,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, owner] of state) out[key] = owner.value;
  return out;
}

export const STAMPED_MODEL_ATTRIBUTE = "metadata.model";
export const STAMPED_MODELS_ATTRIBUTE = "metadata.models";
export const MODEL_METADATA_STAMPED_MARKER =
  "langwatch.reserved.model_metadata_stamped";

/**
 * Stamp `metadata.model` (primary) and `metadata.models` (full set) from the
 * fold's model ranking. Call this at view derivation, never on state.
 *
 * A user-provided value wins. State attributes hold only span-contributed
 * values: the accumulators skip `langwatch.reserved.*` keys, and `fromRow`
 * strips a marker-owned stamp. A present key therefore proves user intent,
 * in any delivery order.
 *
 * The marker tells the read side that we stamped these values. The mapper
 * hides it (`trace-summary.mapper.ts`), and `stripModelStamp` keys on it.
 */
export function stampModelMetadata(
  attributes: Record<string, string>,
  models: readonly string[],
): void {
  if (models.length === 0) return;
  if (
    attributes[STAMPED_MODEL_ATTRIBUTE] !== undefined ||
    attributes[STAMPED_MODELS_ATTRIBUTE] !== undefined
  ) {
    return;
  }
  attributes[STAMPED_MODEL_ATTRIBUTE] = models[0]!;
  attributes[STAMPED_MODELS_ATTRIBUTE] = JSON.stringify([...models]);
  attributes[MODEL_METADATA_STAMPED_MARKER] = "true";
}

/**
 * Remove a marker-owned stamp from read-back attributes. Call this in
 * `fromRow` before the values seed state.
 *
 * The read-back owner has an empty span id, and an empty id beats every
 * real span in `mergeAttribute`. A stale stamp left in state would
 * therefore beat a user's later `metadata.model` forever. Stripping keeps
 * the invariant: state carries user values only, and the next write
 * re-derives the stamp from the reseeded model ranking.
 */
export function stripModelStamp(
  attributes: Record<string, string>,
): Record<string, string> {
  if (attributes[MODEL_METADATA_STAMPED_MARKER] !== "true") return attributes;
  const out = { ...attributes };
  delete out[STAMPED_MODEL_ATTRIBUTE];
  delete out[STAMPED_MODELS_ATTRIBUTE];
  delete out[MODEL_METADATA_STAMPED_MARKER];
  return out;
}

const AI_SPAN_TYPE_KEY = "langwatch.span.type";
const AI_SPAN_TYPES = new Set([
  "llm",
  "chat",
  "completion",
  "rag",
  "agent",
  "tool",
  "chain",
]);

export function spanContainsAi(span: CanonicalSpan): boolean {
  const value = span.attributes[AI_SPAN_TYPE_KEY];
  return typeof value === "string" && AI_SPAN_TYPES.has(value);
}

export function spanType(span: CanonicalSpan): string | null {
  if (span.spanType) return span.spanType;
  const value = span.attributes[AI_SPAN_TYPE_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isRootSpan(span: {
  readonly parentSpanId: string | null;
}): boolean {
  return span.parentSpanId === null;
}
