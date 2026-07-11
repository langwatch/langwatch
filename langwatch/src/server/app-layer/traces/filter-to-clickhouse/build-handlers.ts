import {
  type ExpressionCategoricalDef,
  FACET_REGISTRY,
  type RangeFacetDef,
  TABLE_TIME_COLUMNS,
} from "../facet-registry";
import { EVALUATOR_DEF, LABEL_DEF, MODEL_DEF } from "./custom-handlers";
import {
  type CategoricalRead,
  type FieldDef,
  type FieldNeeds,
  type RangeRead,
} from "./field-def";
import { UNSUPPORTED } from "./field-def";
import {
  categorical,
  crossTableCategorical,
  crossTableRange,
  range,
} from "./generic-translators";
import { META_FIELD_DEFS } from "./meta-handlers";
import type { FieldHandler } from "./value-helpers";

// ---------------------------------------------------------------------------
// Registry lookup — single-sources the SQL `expression` from FACET_REGISTRY so
// the compiled output never drifts from facet discovery.
// ---------------------------------------------------------------------------

const FACET_BY_KEY = new Map(FACET_REGISTRY.map((d) => [d.key, d]));

function expressionFacet(
  key: string,
): ExpressionCategoricalDef | RangeFacetDef {
  const def = FACET_BY_KEY.get(key);
  if (!def) throw new Error(`facet '${key}' is missing from FACET_REGISTRY`);
  if (!("expression" in def)) {
    throw new Error(`facet '${key}' has no expression to derive a handler from`);
  }
  return def;
}

/** Auto-derived `trace_summaries` categorical: direct equality + summary read. */
function categoricalFacet(key: string): FieldDef {
  const def = expressionFacet(key);
  if (def.kind !== "categorical") {
    throw new Error(`facet '${key}' is not a categorical facet`);
  }
  if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
  return categorical(def.expression, def.read, def.key);
}

/** Auto-derived `trace_summaries` range: numeric comparison + summary read. */
function rangeFacet(key: string): FieldDef {
  const def = expressionFacet(key);
  if (def.kind !== "range") {
    throw new Error(`facet '${key}' is not a range facet`);
  }
  if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
  return range(def.expression, def.read, def.key);
}

/**
 * Cross-table categorical (evaluation_runs / stored_spans): subquery SQL from
 * the registry expression, paired with a per-collection in-memory read (the
 * read iterates `trace.evaluations` / `trace.spans` and fails closed when the
 * collection isn't loaded).
 */
function crossCategoricalFacet(
  key: string,
  needs: FieldNeeds,
  read: CategoricalRead,
): FieldDef {
  const def = expressionFacet(key);
  if (def.kind !== "categorical") {
    throw new Error(`facet '${key}' is not a categorical facet`);
  }
  return crossTableCategorical(
    def.table,
    TABLE_TIME_COLUMNS[def.table],
    def.expression,
    read,
    needs,
    def.key,
  );
}

function crossRangeFacet(
  key: string,
  needs: FieldNeeds,
  read: RangeRead,
): FieldDef {
  const def = expressionFacet(key);
  if (def.kind !== "range") {
    throw new Error(`facet '${key}' is not a range facet`);
  }
  return crossTableRange(
    def.table,
    TABLE_TIME_COLUMNS[def.table],
    def.expression,
    read,
    needs,
    def.key,
  );
}

// ---------------------------------------------------------------------------
// Cross-table in-memory reads (item 4: iterate the referenced collection)
// ---------------------------------------------------------------------------

const evaluatorStatusRead: CategoricalRead = (t) =>
  t.evaluations == null ? UNSUPPORTED : t.evaluations.map((e) => e.status);

// Re-expresses the `evaluatorVerdict` multiIf in JS — `error` wins, then the
// 0/1/null `Passed` maps to fail/pass/unknown. Kept in lockstep with the SQL
// expression on the `evaluatorVerdict` facet.
const evaluatorVerdictRead: CategoricalRead = (t) =>
  t.evaluations == null
    ? UNSUPPORTED
    : t.evaluations.map((e) =>
        e.status === "error"
          ? "error"
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
  t.spans == null
    ? UNSUPPORTED
    : t.spans.map((s) => s.attributes["langwatch.span.type"] ?? "");

const spanNameRead: CategoricalRead = (t) =>
  t.spans == null ? UNSUPPORTED : t.spans.map((s) => s.name);

const spanStatusRead: CategoricalRead = (t) =>
  t.spans == null
    ? UNSUPPORTED
    : t.spans.map((s) =>
        s.statusCode === 2 ? "error" : s.statusCode === 1 ? "ok" : "unset",
      );

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
  status: categoricalFacet("status"),
  origin: categoricalFacet("origin"),
  service: categoricalFacet("service"),
  model: MODEL_DEF,
  user: categoricalFacet("user"),
  conversation: categoricalFacet("conversation"),
  customer: categoricalFacet("customer"),
  scenarioRun: META_FIELD_DEFS.scenarioRun,
  topic: categoricalFacet("topic"),
  subtopic: categoricalFacet("subtopic"),
  traceName: categoricalFacet("traceName"),
  rootSpanType: categoricalFacet("rootSpanType"),
  guardrail: categoricalFacet("guardrail"),
  annotation: categoricalFacet("annotation"),
  containsAi: categoricalFacet("containsAi"),
  errorMessage: categoricalFacet("errorMessage"),
  tokensEstimated: categoricalFacet("tokensEstimated"),
  selectedPrompt: categoricalFacet("selectedPrompt"),
  lastUsedPrompt: categoricalFacet("lastUsedPrompt"),
  promptVersion: rangeFacet("promptVersion"),
  label: LABEL_DEF,
  cost: rangeFacet("cost"),
  duration: rangeFacet("duration"),
  tokens: rangeFacet("tokens"),
  ttft: rangeFacet("ttft"),
  ttlt: rangeFacet("ttlt"),
  promptTokens: rangeFacet("promptTokens"),
  completionTokens: rangeFacet("completionTokens"),
  tokensPerSecond: rangeFacet("tokensPerSecond"),
  spans: rangeFacet("spans"),
  size: rangeFacet("size"),
  evaluator: EVALUATOR_DEF,
  evaluatorStatus: crossCategoricalFacet(
    "evaluatorStatus",
    "evaluations",
    evaluatorStatusRead,
  ),
  evaluatorVerdict: crossCategoricalFacet(
    "evaluatorVerdict",
    "evaluations",
    evaluatorVerdictRead,
  ),
  evaluatorScore: crossRangeFacet(
    "evaluatorScore",
    "evaluations",
    evaluatorScoreRead,
  ),
  evaluatorLabel: crossCategoricalFacet(
    "evaluatorLabel",
    "evaluations",
    evaluatorLabelRead,
  ),
  spanType: crossCategoricalFacet("spanType", "spans", spanTypeRead),
  spanName: crossCategoricalFacet("spanName", "spans", spanNameRead),
  spanStatus: crossCategoricalFacet("spanStatus", "spans", spanStatusRead),
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
  evaluatorPassed: crossCategoricalFacet(
    "evaluatorVerdict",
    "evaluations",
    evaluatorVerdictRead,
  ),
} satisfies Record<KnownField, FieldDef>;

/** ClickHouse compilers keyed by field name, derived from {@link FIELD_DEFS}. */
export const FIELD_HANDLERS: Record<string, FieldHandler> = Object.fromEntries(
  Object.entries(FIELD_DEFS).map(([key, def]) => [key, def.toClickHouse]),
);

/** All known filter field names, in registry + meta order. */
export const KNOWN_FIELDS = Object.keys(FIELD_DEFS);
