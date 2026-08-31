import {
  type ExpressionCategoricalDef,
  FACET_REGISTRY,
  type RangeFacetDef,
  TABLE_TIME_COLUMNS,
} from "./trace-facet-registry.clickhouse.adapter";
import type {
  CategoricalRead,
  FieldDef,
  FieldNeeds,
  RangeRead,
} from "./trace-query-evaluation.adapter";
import { UNSUPPORTED } from "./trace-query-evaluation.adapter";
import {
  EVALUATOR_DEF,
  LABEL_DEF,
  MODEL_DEF,
} from "./trace-query-custom-fields.clickhouse.adapter";
import { TraceQueryTranslators } from "./trace-query-translators.clickhouse.adapter";
import { META_FIELD_DEFS } from "./trace-query-meta-fields.clickhouse.adapter";

// ---------------------------------------------------------------------------
// Registry lookup — single-sources the SQL `expression` from FACET_REGISTRY so
// the compiled output never drifts from facet discovery.
// ---------------------------------------------------------------------------

const FACET_BY_KEY = new Map(FACET_REGISTRY.map((d) => [d.key, d]));

// ---------------------------------------------------------------------------
// Cross-table in-memory reads (item 4: iterate the referenced collection)
// ---------------------------------------------------------------------------

const evaluatorStatusRead: CategoricalRead = (t) =>
  t.evaluations == null ? UNSUPPORTED : t.evaluations.map((e) => e.status);

// Re-expresses the `evaluatorVerdict` multiIf in JS — `error` and `skipped`
// win, then the 0/1/null `Passed` maps to fail/pass/unknown. Kept in lockstep
// with the SQL expression on the `evaluatorVerdict` facet.
const evaluatorVerdictRead: CategoricalRead = (t) =>
  t.evaluations == null
    ? UNSUPPORTED
    : t.evaluations.map((e) =>
        e.status === "error"
          ? "error"
          : e.status === "skipped"
            ? "skipped"
            : e.passed === true
              ? "pass"
              : e.passed === false
                ? "fail"
                : "unknown",
      );

const evaluatorScoreRead: RangeRead = (t) =>
  t.evaluations == null
    ? UNSUPPORTED
    : t.evaluations.flatMap((e) => (e.score == null ? [] : [e.score]));

const evaluatorLabelRead: CategoricalRead = (t) =>
  t.evaluations == null
    ? UNSUPPORTED
    : t.evaluations.flatMap((e) => (e.label == null ? [] : [e.label]));

const spanTypeRead: CategoricalRead = (t) =>
  t.spans == null ? UNSUPPORTED : t.spans.map((s) => s.attributes["langwatch.span.type"] ?? "");

const spanNameRead: CategoricalRead = (t) =>
  t.spans == null ? UNSUPPORTED : t.spans.map((s) => s.name);

const spanStatusRead: CategoricalRead = (t) =>
  t.spans == null
    ? UNSUPPORTED
    : t.spans.map((s) => (s.statusCode === 2 ? "error" : s.statusCode === 1 ? "ok" : "unset"));

/**
 * How one field's definition is built.
 *
 * A field needs two answers that must agree: the SQL predicate a filter
 * compiles to, and the in-memory evaluation used where there is no query to
 * run. These five builders pair them, so a field cannot be given one without
 * the other — which is the failure mode this shape exists to prevent, since a
 * field that filters in SQL but not in memory silently disagrees with itself.
 */
export class TraceQueryFields {
  static expressionFacet(key: string): ExpressionCategoricalDef | RangeFacetDef {
    const def = FACET_BY_KEY.get(key);
    if (!def) throw new Error(`facet '${key}' is missing from FACET_REGISTRY`);
    if (!("expression" in def)) {
      throw new Error(`facet '${key}' has no expression to derive a handler from`);
    }
    return def;
  }

  /** Auto-derived `trace_summaries` categorical: direct equality + summary read. */
  static categoricalFacet(key: string): FieldDef {
    const def = TraceQueryFields.expressionFacet(key);
    if (def.kind !== "categorical") {
      throw new Error(`facet '${key}' is not a categorical facet`);
    }
    if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
    return TraceQueryTranslators.categorical(def.expression, def.read, def.key);
  }

  /** Auto-derived `trace_summaries` range: numeric comparison + summary read. */
  static rangeFacet(key: string): FieldDef {
    const def = TraceQueryFields.expressionFacet(key);
    if (def.kind !== "range") {
      throw new Error(`facet '${key}' is not a range facet`);
    }
    if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
    return TraceQueryTranslators.range(def.expression, def.read, def.key);
  }

  /**
   * Cross-table categorical (evaluation_runs / stored_spans): subquery SQL from
   * the registry expression, paired with a per-collection in-memory read (the
   * read iterates `trace.evaluations` / `trace.spans` and fails closed when the
   * collection isn't loaded).
   */
  static crossCategoricalFacet(key: string, needs: FieldNeeds, read: CategoricalRead): FieldDef {
    const def = TraceQueryFields.expressionFacet(key);
    if (def.kind !== "categorical") {
      throw new Error(`facet '${key}' is not a categorical facet`);
    }
    return TraceQueryTranslators.crossTableCategorical(
      def.table,
      TABLE_TIME_COLUMNS[def.table],
      def.expression,
      read,
      needs,
      def.key,
    );
  }

  static crossRangeFacet(key: string, needs: FieldNeeds, read: RangeRead): FieldDef {
    const def = TraceQueryFields.expressionFacet(key);
    if (def.kind !== "range") {
      throw new Error(`facet '${key}' is not a range facet`);
    }
    return TraceQueryTranslators.crossTableRange(
      def.table,
      TABLE_TIME_COLUMNS[def.table],
      def.expression,
      read,
      needs,
      def.key,
    );
  }
}

// ---------------------------------------------------------------------------
// FIELD_DEFS — the exhaustive registry of filter fields.
//
// `satisfies Record<KnownField, FieldDef>` is the drift guardrail: because
// `FieldDef` requires BOTH a `toClickHouse` and an `evaluateInMemory`, and
// `KnownField` is an independent exhaustive union, TypeScript rejects a field
// wired with only one side, a field missing from this object, or a stray key.
// Insertion order is preserved so `KNOWN_FIELDS` matches the historical order.
// ---------------------------------------------------------------------------

/** Every filter field name, mirrored by {@link FIELD_DEFS}'s keys. */
export type KnownField =
  | "status"
  | "origin"
  | "service"
  | "model"
  | "user"
  | "conversation"
  | "customer"
  | "scenarioRun"
  | "topic"
  | "subtopic"
  | "traceName"
  | "rootSpanType"
  | "guardrail"
  | "annotation"
  | "containsAi"
  | "errorMessage"
  | "tokensEstimated"
  | "selectedPrompt"
  | "lastUsedPrompt"
  | "promptVersion"
  | "label"
  | "cost"
  | "duration"
  | "tokens"
  | "ttft"
  | "ttlt"
  | "promptTokens"
  | "completionTokens"
  | "tokensPerSecond"
  | "spans"
  | "size"
  | "evaluator"
  | "evaluatorStatus"
  | "evaluatorVerdict"
  | "evaluatorScore"
  | "evaluatorLabel"
  | "spanType"
  | "spanName"
  | "spanStatus"
  | "has"
  | "none"
  | "eval"
  | "event"
  | "trace"
  | "traceId"
  | "prompt"
  | "spanId"
  | "scenario"
  | "scenarioSet"
  | "scenarioBatch"
  | "scenarioVerdict"
  | "scenarioStatus"
  | "evaluatorPassed";

export const FIELD_DEFS = {
  status: TraceQueryFields.categoricalFacet("status"),
  origin: TraceQueryFields.categoricalFacet("origin"),
  service: TraceQueryFields.categoricalFacet("service"),
  model: MODEL_DEF,
  user: TraceQueryFields.categoricalFacet("user"),
  conversation: TraceQueryFields.categoricalFacet("conversation"),
  customer: TraceQueryFields.categoricalFacet("customer"),
  scenarioRun: META_FIELD_DEFS.scenarioRun,
  topic: TraceQueryFields.categoricalFacet("topic"),
  subtopic: TraceQueryFields.categoricalFacet("subtopic"),
  traceName: TraceQueryFields.categoricalFacet("traceName"),
  rootSpanType: TraceQueryFields.categoricalFacet("rootSpanType"),
  guardrail: TraceQueryFields.categoricalFacet("guardrail"),
  annotation: TraceQueryFields.categoricalFacet("annotation"),
  containsAi: TraceQueryFields.categoricalFacet("containsAi"),
  errorMessage: TraceQueryFields.categoricalFacet("errorMessage"),
  tokensEstimated: TraceQueryFields.categoricalFacet("tokensEstimated"),
  selectedPrompt: TraceQueryFields.categoricalFacet("selectedPrompt"),
  lastUsedPrompt: TraceQueryFields.categoricalFacet("lastUsedPrompt"),
  promptVersion: TraceQueryFields.rangeFacet("promptVersion"),
  label: LABEL_DEF,
  cost: TraceQueryFields.rangeFacet("cost"),
  duration: TraceQueryFields.rangeFacet("duration"),
  tokens: TraceQueryFields.rangeFacet("tokens"),
  ttft: TraceQueryFields.rangeFacet("ttft"),
  ttlt: TraceQueryFields.rangeFacet("ttlt"),
  promptTokens: TraceQueryFields.rangeFacet("promptTokens"),
  completionTokens: TraceQueryFields.rangeFacet("completionTokens"),
  tokensPerSecond: TraceQueryFields.rangeFacet("tokensPerSecond"),
  spans: TraceQueryFields.rangeFacet("spans"),
  size: TraceQueryFields.rangeFacet("size"),
  evaluator: EVALUATOR_DEF,
  evaluatorStatus: TraceQueryFields.crossCategoricalFacet(
    "evaluatorStatus",
    "evaluations",
    evaluatorStatusRead,
  ),
  evaluatorVerdict: TraceQueryFields.crossCategoricalFacet(
    "evaluatorVerdict",
    "evaluations",
    evaluatorVerdictRead,
  ),
  evaluatorScore: TraceQueryFields.crossRangeFacet(
    "evaluatorScore",
    "evaluations",
    evaluatorScoreRead,
  ),
  evaluatorLabel: TraceQueryFields.crossCategoricalFacet(
    "evaluatorLabel",
    "evaluations",
    evaluatorLabelRead,
  ),
  spanType: TraceQueryFields.crossCategoricalFacet("spanType", "spans", spanTypeRead),
  spanName: TraceQueryFields.crossCategoricalFacet("spanName", "spans", spanNameRead),
  spanStatus: TraceQueryFields.crossCategoricalFacet("spanStatus", "spans", spanStatusRead),
  has: META_FIELD_DEFS.has,
  none: META_FIELD_DEFS.none,
  eval: META_FIELD_DEFS.eval,
  event: META_FIELD_DEFS.event,
  trace: META_FIELD_DEFS.trace,
  traceId: META_FIELD_DEFS.traceId,
  prompt: META_FIELD_DEFS.prompt,
  spanId: META_FIELD_DEFS.spanId,
  scenario: META_FIELD_DEFS.scenario,
  scenarioSet: META_FIELD_DEFS.scenarioSet,
  scenarioBatch: META_FIELD_DEFS.scenarioBatch,
  scenarioVerdict: META_FIELD_DEFS.scenarioVerdict,
  scenarioStatus: META_FIELD_DEFS.scenarioStatus,
  // Back-compat alias for the renamed `evaluatorVerdict` field. Any saved
  // query/lens using the old key keeps working; the SQL + predicate are the
  // same as `evaluatorVerdict`.
  evaluatorPassed: TraceQueryFields.crossCategoricalFacet(
    "evaluatorVerdict",
    "evaluations",
    evaluatorVerdictRead,
  ),
} satisfies Record<KnownField, FieldDef>;

/**
 * Field lookup for both the ClickHouse compiler and the in-memory evaluator.
 *
 * A `Map`, not a plain object: field names come straight from a user-authored
 * filter string, and a plain-object index resolves `constructor` / `toString` /
 * `__proto__` off `Object.prototype`. That inherited value is truthy, so it
 * slipped past both `if (!handler)` (the save-time unknown-field gate, which
 * then compiled `constructor:x` into nonsense instead of rejecting it) and
 * `if (!def)` in the evaluator (which then threw `def.evaluateInMemory is not a
 * function` straight out of the supposedly fail-closed matcher). `Map.get`
 * has own-key semantics, so an inherited name is simply an unknown field.
 */
export const FIELD_DEF_BY_NAME: ReadonlyMap<string, FieldDef> = new Map(Object.entries(FIELD_DEFS));

/** All known filter field names, in registry + meta order. */
export const KNOWN_FIELDS = Object.keys(FIELD_DEFS);
