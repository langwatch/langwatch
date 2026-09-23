import type { CategoricalRead, FieldDef, FieldNeeds, RangeRead } from "@langwatch/trace-contract";
import { UNSUPPORTED } from "@langwatch/trace-contract";

import { ClickHouseFacetRegistryAdapter } from "./clickhouse.trace-facet-registry.repository.ts";
import {
  type ExpressionCategoricalDef,
  type RangeFacetDef,
} from "./clickhouse.trace-facet-registry.repository.ts";
import { ClickHouseTraceQueryCustomFieldsAdapter } from "./clickhouse.trace-query-custom-fields.repository.ts";
import { INSTANT_EVAL_FIELD_DEFS } from "./clickhouse.trace-query-instant-eval-fields.repository.ts";
import { META_FIELD_DEFS } from "./clickhouse.trace-query-meta-fields.repository.ts";
import { ClickHouseTraceQueryTranslatorsRepository } from "./clickhouse.trace-query-translators.repository.ts";

// ---------------------------------------------------------------------------
// Registry lookup — single-sources SQL expressions from the facet registry.
// ---------------------------------------------------------------------------

const FACET_BY_KEY = new Map(ClickHouseFacetRegistryAdapter.FACET_REGISTRY.map((d) => [d.key, d]));

// ---------------------------------------------------------------------------
// Cross-table in-memory reads (item 4: iterate the referenced collection)
// ---------------------------------------------------------------------------

const evaluatorStatusRead: CategoricalRead = (t) =>
  t.evaluations == null ? UNSUPPORTED : t.evaluations.map((e) => e.status);

// Re-expresses the `evaluatorVerdict` multiIf in JS — `error` and `skipped`
// win, then the 0/1/null `Passed` maps to fail/pass/unknown. Kept in lockstep
// with the SQL expression on the `evaluatorVerdict` facet.
function evaluatorVerdictOf(evaluation: {
  status?: string | null;
  passed?: boolean | null;
}): "error" | "fail" | "pass" | "skipped" | "unknown" {
  if (evaluation.status === "error") return "error";
  if (evaluation.status === "skipped") return "skipped";
  if (evaluation.passed === true) return "pass";
  if (evaluation.passed === false) return "fail";

  return "unknown";
}

const evaluatorVerdictRead: CategoricalRead = (t) =>
  t.evaluations == null ? UNSUPPORTED : t.evaluations.map(evaluatorVerdictOf);

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

function spanStatusOf(statusCode: number | null | undefined): string {
  if (statusCode === 2) return "error";
  if (statusCode === 1) return "ok";

  return "unset";
}

const spanStatusRead: CategoricalRead = (t) =>
  t.spans == null ? UNSUPPORTED : t.spans.map((s) => spanStatusOf(s.statusCode));

/**
 * Pairs SQL predicates with in-memory evaluations for each field.
 */
export class ClickHouseTraceQueryFieldsRepository {
  private constructor(private readonly translators: ClickHouseTraceQueryTranslatorsRepository) {}

  static create(): ClickHouseTraceQueryFieldsRepository {
    return new ClickHouseTraceQueryFieldsRepository(
      ClickHouseTraceQueryTranslatorsRepository.create(),
    );
  }

  expressionFacet(key: string): ExpressionCategoricalDef | RangeFacetDef {
    const def = FACET_BY_KEY.get(key);
    if (!def)
      throw new Error(
        `facet '${key}' is missing from ClickHouseFacetRegistryAdapter.FACET_REGISTRY`,
      );
    if (!("expression" in def)) {
      throw new Error(`facet '${key}' has no expression to derive a handler from`);
    }
    return def;
  }

  /** Auto-derived `trace_summaries` categorical: direct equality + summary read. */
  categoricalFacet(key: string): FieldDef {
    const def = this.expressionFacet(key);
    if (def.kind !== "categorical") {
      throw new Error(`facet '${key}' is not a categorical facet`);
    }
    if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
    return this.translators.categorical(def.expression, def.read, def.key);
  }

  /** Auto-derived `trace_summaries` range: numeric comparison + summary read. */
  rangeFacet(key: string): FieldDef {
    const def = this.expressionFacet(key);
    if (def.kind !== "range") {
      throw new Error(`facet '${key}' is not a range facet`);
    }
    if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
    return this.translators.range(def.expression, def.read, def.key);
  }

  /**
   * Cross-table categorical paired with per-collection in-memory read.
   */
  crossCategoricalFacet(key: string, needs: FieldNeeds, read: CategoricalRead): FieldDef {
    const def = this.expressionFacet(key);
    if (def.kind !== "categorical") {
      throw new Error(`facet '${key}' is not a categorical facet`);
    }
    return this.translators.crossTableCategorical({
      table: def.table,
      timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[def.table],
      expression: def.expression,
      read,
      needs,
      name: def.key,
    });
  }

  crossRangeFacet(key: string, needs: FieldNeeds, read: RangeRead): FieldDef {
    const def = this.expressionFacet(key);
    if (def.kind !== "range") {
      throw new Error(`facet '${key}' is not a range facet`);
    }
    return this.translators.crossTableRange({
      table: def.table,
      timeColumn: ClickHouseFacetRegistryAdapter.TABLE_TIME_COLUMNS[def.table],
      expression: def.expression,
      read,
      needs,
      name: def.key,
    });
  }
}

const traceQueryFieldsRepository = ClickHouseTraceQueryFieldsRepository.create();

// FIELD_DEFS — the exhaustive registry of filter fields. satisfies
// Record<KnownField, FieldDef> is the drift guardrail: FieldDef requires
// BOTH toClickHouse and evaluateInMemory, and KnownField is an independent
// exhaustive union, so TypeScript rejects a one-sided field, a field missing
// here, or a stray key. Insertion order matches KNOWN_FIELDS' historical order.

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
  | "eval.trace"
  | "eval.conversation"
  | "eval.llm"
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
  status: traceQueryFieldsRepository.categoricalFacet("status"),
  origin: traceQueryFieldsRepository.categoricalFacet("origin"),
  service: traceQueryFieldsRepository.categoricalFacet("service"),
  model: ClickHouseTraceQueryCustomFieldsAdapter.MODEL_DEF,
  user: traceQueryFieldsRepository.categoricalFacet("user"),
  conversation: traceQueryFieldsRepository.categoricalFacet("conversation"),
  customer: traceQueryFieldsRepository.categoricalFacet("customer"),
  scenarioRun: META_FIELD_DEFS.scenarioRun,
  topic: traceQueryFieldsRepository.categoricalFacet("topic"),
  subtopic: traceQueryFieldsRepository.categoricalFacet("subtopic"),
  traceName: traceQueryFieldsRepository.categoricalFacet("traceName"),
  rootSpanType: traceQueryFieldsRepository.categoricalFacet("rootSpanType"),
  guardrail: traceQueryFieldsRepository.categoricalFacet("guardrail"),
  annotation: traceQueryFieldsRepository.categoricalFacet("annotation"),
  containsAi: traceQueryFieldsRepository.categoricalFacet("containsAi"),
  errorMessage: traceQueryFieldsRepository.categoricalFacet("errorMessage"),
  tokensEstimated: traceQueryFieldsRepository.categoricalFacet("tokensEstimated"),
  selectedPrompt: traceQueryFieldsRepository.categoricalFacet("selectedPrompt"),
  lastUsedPrompt: traceQueryFieldsRepository.categoricalFacet("lastUsedPrompt"),
  promptVersion: traceQueryFieldsRepository.rangeFacet("promptVersion"),
  label: ClickHouseTraceQueryCustomFieldsAdapter.LABEL_DEF,
  cost: traceQueryFieldsRepository.rangeFacet("cost"),
  duration: traceQueryFieldsRepository.rangeFacet("duration"),
  tokens: traceQueryFieldsRepository.rangeFacet("tokens"),
  ttft: traceQueryFieldsRepository.rangeFacet("ttft"),
  ttlt: traceQueryFieldsRepository.rangeFacet("ttlt"),
  promptTokens: traceQueryFieldsRepository.rangeFacet("promptTokens"),
  completionTokens: traceQueryFieldsRepository.rangeFacet("completionTokens"),
  tokensPerSecond: traceQueryFieldsRepository.rangeFacet("tokensPerSecond"),
  spans: traceQueryFieldsRepository.rangeFacet("spans"),
  size: traceQueryFieldsRepository.rangeFacet("size"),
  evaluator: ClickHouseTraceQueryCustomFieldsAdapter.EVALUATOR_DEF,
  evaluatorStatus: traceQueryFieldsRepository.crossCategoricalFacet(
    "evaluatorStatus",
    "evaluations",
    evaluatorStatusRead,
  ),
  evaluatorVerdict: traceQueryFieldsRepository.crossCategoricalFacet(
    "evaluatorVerdict",
    "evaluations",
    evaluatorVerdictRead,
  ),
  evaluatorScore: traceQueryFieldsRepository.crossRangeFacet(
    "evaluatorScore",
    "evaluations",
    evaluatorScoreRead,
  ),
  evaluatorLabel: traceQueryFieldsRepository.crossCategoricalFacet(
    "evaluatorLabel",
    "evaluations",
    evaluatorLabelRead,
  ),
  spanType: traceQueryFieldsRepository.crossCategoricalFacet("spanType", "spans", spanTypeRead),
  spanName: traceQueryFieldsRepository.crossCategoricalFacet("spanName", "spans", spanNameRead),
  spanStatus: traceQueryFieldsRepository.crossCategoricalFacet(
    "spanStatus",
    "spans",
    spanStatusRead,
  ),
  has: META_FIELD_DEFS.has,
  none: META_FIELD_DEFS.none,
  // An Instant Eval run's verdicts, or the evaluator-name lookup the bare
  // field was before, when no run is registered for the chip.
  eval: INSTANT_EVAL_FIELD_DEFS.eval,
  "eval.trace": INSTANT_EVAL_FIELD_DEFS["eval.trace"],
  "eval.conversation": INSTANT_EVAL_FIELD_DEFS["eval.conversation"],
  "eval.llm": INSTANT_EVAL_FIELD_DEFS["eval.llm"],
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
  evaluatorPassed: traceQueryFieldsRepository.crossCategoricalFacet(
    "evaluatorVerdict",
    "evaluations",
    evaluatorVerdictRead,
  ),
} satisfies Record<KnownField, FieldDef>;

/**
 * Field lookup using Map for safe own-key semantics against user input.
 */
export const FIELD_DEF_BY_NAME: ReadonlyMap<string, FieldDef> = new Map(Object.entries(FIELD_DEFS));

/** All known filter field names, in registry + meta order. */
export const KNOWN_FIELDS = Object.keys(FIELD_DEFS);
