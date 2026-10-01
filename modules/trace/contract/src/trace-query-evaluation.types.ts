import type { TagToken } from "liqe";

import type { DerivedTraceEvent } from "./trace-derived-event.ts";
import type { ResolvedInstantEvalRun } from "./trace-instant-eval-chips.ts";
import type { TraceSummaryData } from "./trace-projection.ts";

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
  /**
   * The Instant Eval runs the caller registered for its `eval` chips, already
   * checked against the project. Absent when the query carries no such chip.
   */
  evalRuns?: readonly ResolvedInstantEvalRun[];
}

export type FieldHandler = (tag: TagToken, negated: boolean, context: TranslationContext) => string;

/**
 * Minimal per-span shape for in-memory evaluator span-scoped fields. Spans
 * typically absent (derived later); evaluate to UNSUPPORTED. Pinned for contract.
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
 * Trace data available to field predicates. summary is always loaded;
 * auxiliary collections load lazily and return UNSUPPORTED if missing.
 */
export interface InMemoryTrace {
  summary: TraceSummaryData;
  evaluations?: TraceQueryEvaluationRun[] | null;
  events?: DerivedTraceEvent[] | null;
  spans?: DerivedSpanRow[] | null;
}

/**
 * Returned by evaluateInMemory when field can't be evaluated from available
 * data (size, spans, unloaded collections). Any such tag fails query to false.
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
 * Single filter field declaring BOTH sides (ClickHouse + in-memory predicate)
 * so they can't drift. Every known field maps to one via satisfies.
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
