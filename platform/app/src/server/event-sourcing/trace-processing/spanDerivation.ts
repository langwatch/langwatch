import type { CanonicalSpan } from "./schema";

/**
 * Span-derivation helpers shared by `traceSummary.ts` and `traceAnalytics.ts`.
 * Every function is commutative+associative, monotone over a declared
 * lattice, or last-write-wins carrying its own domain stamp (ADR-098 §4).
 */

// ---------------------------------------------------------------------------
// The processing cap (specs/trace-processing/oversized-trace-lighter-processing.feature)
// ---------------------------------------------------------------------------

/**
 * Past this many processed spans a trace stops paying per-span derivation
 * cost. `spanStorage` is never gated by it — every span is still persisted.
 * `spanCount` is not gated either, so the trace's true magnitude stays
 * visible; `derivationCapped` tells a reader some contributions were skipped.
 */
export const MAX_PROCESSED_SPANS = 512;

// ---------------------------------------------------------------------------
// The ADR-099 storage anchor — the ONE deliberately accepted exception to
// this pipeline's order-invariance discipline
// ---------------------------------------------------------------------------

/**
 * Freezes a value on first observation — the ADR-099 storage anchor both
 * tables partition and TTL on. A storage address, never a business value.
 */
export function anchorOnce(current: number, candidateMs: number): number {
  if (current !== 0) return current;
  if (!Number.isFinite(candidateMs) || candidateMs <= 0) return current;
  return candidateMs;
}

// ---------------------------------------------------------------------------
// Bytewise comparison (ADR-098 §5: never localeCompare)
// ---------------------------------------------------------------------------

export function isBytewiseSmaller(a: string, b: string): boolean {
  return a < b;
}

// ---------------------------------------------------------------------------
// Error message — was first-write-wins-no-stamp; now monotone by tier
// ---------------------------------------------------------------------------

/**
 * Error-message selection is a declared lattice: rank 3 (exception event)
 * beats rank 2 (attribute) beats rank 1 (`statusMessage`), ties broken
 * bytewise on the span id.
 */
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
  return isBytewiseSmaller(candidate.spanId, current.spanId) ? candidate : current;
}

// ---------------------------------------------------------------------------
// Model usage — was "most-recently-folded-first"; now LWW by span start time
// ---------------------------------------------------------------------------

/**
 * Each model carries its latest-seen span start time, so "primary model" is
 * a read-time sort over the accumulated set rather than an arrival order.
 */
export type ModelUsage = ReadonlyMap<string, number>;

export function mergeModelUsage(state: ModelUsage, model: string, spanStartMs: number): ModelUsage {
  const existing = state.get(model);
  if (existing !== undefined && existing >= spanStartMs) return state;
  const next = new Map(state);
  next.set(model, spanStartMs);
  return next;
}

/** Models ordered most-recently-used first — a pure read-time derivation. */
export function orderedModels(usage: ModelUsage): string[] {
  return [...usage.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([model]) => model);
}

// ---------------------------------------------------------------------------
// Root/name candidate selection — was "rotate current claim"; now a plain min
// ---------------------------------------------------------------------------

/**
 * Root and fallback name candidates are two independent running minimums over
 * `(startTimeMs, spanId)`, bytewise on the id for ties. Which one is
 * authoritative is a read-time decision, not a fold-time one.
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

// ---------------------------------------------------------------------------
// IO selection (computedInput / computedOutput) — tier + domain-time lattice
// ---------------------------------------------------------------------------

/**
 * 2 = root span, 1 = an explicit `langwatch.input`/`langwatch.output` match,
 * 0 = a non-semantic fallback extraction. The maximum `(tier, endTimeMs,
 * spanId)` triple wins.
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
  if (candidate.tier !== current.tier) return candidate.tier > current.tier ? candidate : current;
  if (candidate.endTimeMs !== current.endTimeMs) {
    return candidate.endTimeMs > current.endTimeMs ? candidate : current;
  }
  return isBytewiseSmaller(candidate.spanId, current.spanId) ? candidate : current;
}

// ---------------------------------------------------------------------------
// Cost / tokens — sum once, round once (was: rounded to 6dp on every step)
// ---------------------------------------------------------------------------

/**
 * Costs accumulate raw and round once at read time. Rounding every step makes
 * the sum order-dependent, because float addition is not associative.
 */
export function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

// ---------------------------------------------------------------------------
// Prompt tracking
// ---------------------------------------------------------------------------

/** Ordered by start time, ties broken bytewise on `spanId`. */
export interface PromptCandidate {
  readonly promptId: string;
  readonly spanId: string;
  readonly startTimeMs: number;
}

export function isLaterPrompt(
  current: PromptCandidate | null,
  candidate: PromptCandidate,
): boolean {
  if (current === null) return true;
  if (candidate.startTimeMs !== current.startTimeMs) {
    return candidate.startTimeMs > current.startTimeMs;
  }
  // Tie on start time: bytewise-larger span id wins. Arbitrary but total and
  // deterministic — the exact mirror of every other tiebreak in this module,
  // just resolving to "larger" instead of "smaller" to match the old
  // service's `>` convention exactly, since this comparator (unlike the
  // others in this file) was already order-invariant and is carried forward
  // unchanged rather than redesigned.
  return candidate.spanId > current.spanId;
}

// ---------------------------------------------------------------------------
// Annotations — was add(guarded)/remove(unconditional), proven non-commutative
// ---------------------------------------------------------------------------

/**
 * Every annotation add/remove carries its own `actedAt` — our boundary's
 * clock, set when the user acted — and the later stamp wins regardless of
 * fold order. A bulk sync is a whole-bucket last-write-wins replace against
 * the same stamp, so it can both add and remove.
 */
export interface AnnotationRecord {
  readonly present: boolean;
  readonly actedAt: number;
}
export type AnnotationState = ReadonlyMap<string, AnnotationRecord>;

export function applyAnnotationChange(
  state: AnnotationState,
  annotationId: string,
  present: boolean,
  actedAt: number,
): AnnotationState {
  const existing = state.get(annotationId);
  if (existing !== undefined && existing.actedAt > actedAt) return state;
  if (existing !== undefined && existing.actedAt === actedAt && existing.present === present) {
    return state;
  }
  const next = new Map(state);
  next.set(annotationId, { present, actedAt });
  return next;
}

export function applyAnnotationBulkSync(
  state: AnnotationState,
  annotationIds: readonly string[],
  actedAt: number,
): AnnotationState {
  const named = new Set(annotationIds);
  const affectedIds = new Set([...state.keys(), ...named]);
  let next = state;
  for (const id of affectedIds) {
    next = applyAnnotationChange(next, id, named.has(id), actedAt);
  }
  return next;
}

export function presentAnnotationIds(state: AnnotationState): string[] {
  return [...state.entries()]
    .filter(([, record]) => record.present)
    .map(([id]) => id)
    .sort();
}

// ---------------------------------------------------------------------------
// PII redaction span-id tracking — was unbounded array.push, duplicating on
// redelivery; now a capped, deterministic set
// ---------------------------------------------------------------------------

/**
 * PII span ids are a set union capped at {@link MAX_TRACKED_PII_SPAN_IDS},
 * keeping the bytewise-smallest ids so the kept set is the same whatever the
 * arrival order. `overflowed` tells a reader the set was truncated.
 */
export const MAX_TRACKED_PII_SPAN_IDS = 1000;

export interface PIISpanIdSet {
  readonly ids: ReadonlySet<string>;
  readonly overflowed: boolean;
}

export function emptyPIISpanIdSet(): PIISpanIdSet {
  return { ids: new Set(), overflowed: false };
}

export function addPIISpanId(state: PIISpanIdSet, spanId: string): PIISpanIdSet {
  if (state.ids.has(spanId)) return state;
  if (state.ids.size < MAX_TRACKED_PII_SPAN_IDS) {
    const next = new Set(state.ids);
    next.add(spanId);
    return { ids: next, overflowed: state.overflowed };
  }
  // At capacity: only admit spanId if it displaces the current largest id,
  // keeping the set's membership a deterministic function of the FULL id set
  // seen so far — the bytewise-smallest N — never of arrival order.
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

// ---------------------------------------------------------------------------
// Attribute maps — was "existing state wins" (first-write); now smallest-id LWW
// ---------------------------------------------------------------------------

/**
 * Each attribute key's value is owned by the bytewise-smallest contributing
 * span id. A `metadata.*` value is one atomic value, not deep-merged.
 */
export interface AttributeOwner {
  readonly value: string;
  readonly spanId: string;
}
export type OwnedAttributeMap = ReadonlyMap<string, AttributeOwner>;

export function mergeAttribute(
  state: OwnedAttributeMap,
  key: string,
  value: string,
  spanId: string,
): OwnedAttributeMap {
  const existing = state.get(key);
  if (existing !== undefined && !isBytewiseSmaller(spanId, existing.spanId)) return state;
  const next = new Map(state);
  next.set(key, { value, spanId });
  return next;
}

export function attributeValues(state: OwnedAttributeMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, owner] of state) out[key] = owner.value;
  return out;
}

// ---------------------------------------------------------------------------
// Span classification helpers
// ---------------------------------------------------------------------------

const AI_SPAN_TYPE_KEY = "langwatch.span.type";
const AI_SPAN_TYPES = new Set(["llm", "chat", "completion", "rag", "agent", "tool", "chain"]);

export function spanContainsAi(span: CanonicalSpan): boolean {
  const spanType = span.attributes[AI_SPAN_TYPE_KEY];
  return typeof spanType === "string" && AI_SPAN_TYPES.has(spanType);
}

export function spanType(span: CanonicalSpan): string | null {
  const value = span.attributes[AI_SPAN_TYPE_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isRootSpan(span: CanonicalSpan): boolean {
  return span.parentSpanId === null;
}
