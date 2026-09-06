import type { TagToken } from "liqe";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { TraceSummaryData } from "../types";
import type { FieldHandler } from "./value-helpers";

/**
 * Minimal per-span shape the in-memory evaluator reads for span-scoped fields
 * (`spanType` / `spanName` / `spanStatus`). Deriving spans at dispatch time is
 * a later phase, so today `InMemoryTrace.spans` is typically absent and those
 * fields evaluate to {@link UNSUPPORTED}. The type is pinned now so the field
 * defs can be written against a stable contract.
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
 * The trace data a field's in-memory predicate can read. `summary` is the fold
 * state the dispatcher always has; the auxiliary collections are loaded lazily
 * (see {@link FieldDef.needs}) and are `null`/absent until a phase that wires
 * them lands — a field that reads a missing collection returns
 * {@link UNSUPPORTED}.
 */
export interface InMemoryTrace {
  summary: TraceSummaryData;
  evaluations?: EvaluationRunData[] | null;
  events?: DerivedTraceEvent[] | null;
  spans?: DerivedSpanRow[] | null;
}

/**
 * Returned by `evaluateInMemory` when a field cannot be positively evaluated
 * from the data available at dispatch time (e.g. `size`, span-scoped fields, or
 * a cross-table collection that wasn't loaded). Any tag yielding this makes the
 * whole query fail closed to `false` — the in-memory side never guesses `true`.
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
export type CategoricalRead = (
  trace: InMemoryTrace,
) => string | string[] | null | Unsupported;

/** In-memory accessor mirroring a range field's ClickHouse `expression`. */
export type RangeRead = (
  trace: InMemoryTrace,
) => number | number[] | null | Unsupported;

/**
 * A single filter field, declaring BOTH sides so they cannot drift: the
 * ClickHouse compilation and the in-memory predicate. `build-handlers.ts`
 * asserts every known field maps to one of these (`satisfies Record<KnownField,
 * FieldDef>`), and `FieldDef` requiring both sides is the type-level guardrail —
 * a field missing either side, or a stray key, fails to compile.
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
