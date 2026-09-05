import type { DerivedTraceEvent, TagToken, TraceSummaryData } from "@langwatch/trace-contract";

export interface TraceQueryEvaluationRun {
  evaluatorId: string;
  evaluatorName: string | null;
  status: string;
  passed: boolean | null;
  score: number | null;
  label: string | null;
}

export interface TranslationContext {
  paramCounter: number;
  nodeCount: number;
  params: Record<string, unknown>;
  tenantId: string;
  timeRange: { from: number; to: number };
}

export type FieldHandler = (tag: TagToken, negated: boolean, context: TranslationContext) => string;

/**
 * Minimal per-span shape the in-memory evaluator reads for span-scoped fields (spanType/spanName/spanStatus). Deriving spans at dispatch time is a later phase, so InMemoryTrace.spans is typically absent today and those fields evaluate to {@link UNSUPPORTED}. Pinned now so field defs can be written against a stable contract.
 */
export interface DerivedSpanRow {
  /** `stored_spans.SpanName`. */
  name: string;
  /** OTel `stored_spans.StatusCode` — `1` ok, `2` error, `0`/null unset. */
  statusCode: number | null;
  /** `stored_spans.SpanAttributes` map. */
  attributes: Record<string, string>;
}

/**
 * Trace data a field's in-memory predicate can read. summary is the fold state the dispatcher always has; auxiliary collections (see {@link FieldDef.needs}) load lazily and are null/absent until a phase wires them, so a field reading a missing one returns {@link UNSUPPORTED}.
 */
export interface InMemoryTrace {
  summary: TraceSummaryData;
  evaluations?: TraceQueryEvaluationRun[] | null;
  events?: DerivedTraceEvent[] | null;
  spans?: DerivedSpanRow[] | null;
}

/**
 * Returned by evaluateInMemory when a field can't be positively evaluated from data available at dispatch (size, span-scoped fields, an unloaded cross-table collection). Any such tag fails the whole query closed to false — the in-memory side never guesses true.
 */
export const UNSUPPORTED = Symbol("unsupported-at-dispatch");
export type Unsupported = typeof UNSUPPORTED;

/**
 * Which auxiliary collection a field reads, so a dispatcher can load only what
 * a query references (parallels `triggerFiltersReferenceEvents`). Absent means
 * the field is answered from the trace summary alone.
 */
export type FieldNeeds = "evaluations" | "events" | "spans";

/** In-memory accessor mirroring a categorical field's ClickHouse `expression`. */
export type CategoricalRead = (trace: InMemoryTrace) => string | string[] | null | Unsupported;

/** In-memory accessor mirroring a range field's ClickHouse `expression`. */
export type RangeRead = (trace: InMemoryTrace) => number | number[] | null | Unsupported;

/**
 * A single filter field, declaring BOTH sides so they can't drift: CH compilation and the in-memory predicate. build-handlers.ts asserts every known field maps to one via satisfies Record<KnownField, FieldDef> — a field missing either side, or a stray key, fails to compile.
 */
export interface FieldDef {
  /** Compiles the tag to a parameterised ClickHouse WHERE fragment. */
  toClickHouse: FieldHandler;
  /** Evaluates the tag against an in-memory trace, or {@link UNSUPPORTED}. */
  evaluateInMemory: (
    tag: TagToken,
    negated: boolean,
    trace: InMemoryTrace,
  ) => boolean | Unsupported;
  /** Auxiliary collection this field reads (absent = trace summary only). */
  needs?: FieldNeeds;
}
