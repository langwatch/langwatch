import type { CategoricalRead, FieldDef, FieldNeeds, RangeRead } from "@langwatch/trace-contract";

import type { TraceFacetRegistryRepository } from "../repositories/trace-facet-registry.repository.ts";
import type {
  ExpressionCategoricalDef,
  FacetCatalog,
  FacetDefinition,
  RangeFacetDef,
} from "../rules/trace-facet-registry.rules.ts";
import { EVALUATOR_DEF, LABEL_DEF, MODEL_DEF } from "../rules/trace-query-custom-fields.rules.ts";
import {
  evaluatorLabelRead,
  evaluatorScoreRead,
  evaluatorStatusRead,
  evaluatorVerdictRead,
  type KnownField,
  spanNameRead,
  spanStatusRead,
  spanTypeRead,
} from "../rules/trace-query-fields.rules.ts";
import { INSTANT_EVAL_FIELD_DEFS } from "../rules/trace-query-instant-eval-fields.rules.ts";
import { META_FIELD_DEFS } from "../rules/trace-query-meta-fields.rules.ts";
import {
  categorical,
  crossTableCategorical,
  crossTableRange,
  range,
} from "../rules/trace-query-translators.rules.ts";

/**
 * The filter fields, each pairing its SQL predicate with its in-memory
 * evaluation, single-sourced from the facet registry's expressions.
 */
export class TraceQueryFieldsService {
  /**
   * Every filter field. `satisfies Record<KnownField, FieldDef>` is the drift
   * guard: a one-sided, missing or stray field fails to compile.
   */
  readonly fieldDefs: Readonly<Record<KnownField, FieldDef>>;
  /** Field lookup over own keys only, safe against user input. */
  readonly fieldDefByName: ReadonlyMap<string, FieldDef>;
  /** All known filter field names, in registry + meta order. */
  readonly knownFields: readonly string[];
  readonly #catalog: FacetCatalog;
  readonly #facetByKey: ReadonlyMap<string, FacetDefinition>;

  static create({
    facetRegistry,
  }: {
    facetRegistry: TraceFacetRegistryRepository;
  }): TraceQueryFieldsService {
    return new TraceQueryFieldsService(facetRegistry.getCatalog());
  }

  private constructor(catalog: FacetCatalog) {
    this.#catalog = catalog;
    this.#facetByKey = new Map(catalog.registry.map((d) => [d.key, d]));
    this.fieldDefs = {
      ...this.#primaryFieldDefs(),
      // Back-compat alias for the renamed `evaluatorVerdict` field. Any saved
      // query/lens using the old key keeps working; the SQL + predicate are the
      // same as `evaluatorVerdict`.
      evaluatorPassed: this.#crossCategoricalFacet(
        "evaluatorVerdict",
        "evaluations",
        evaluatorVerdictRead,
      ),
    } satisfies Record<KnownField, FieldDef>;
    this.fieldDefByName = new Map(Object.entries(this.fieldDefs));
    this.knownFields = Object.keys(this.fieldDefs);
  }

  /** Every field except the back-compat alias, in registry + meta order. */
  #primaryFieldDefs(): Record<Exclude<KnownField, "evaluatorPassed">, FieldDef> {
    return {
      status: this.#categoricalFacet("status"),
      origin: this.#categoricalFacet("origin"),
      service: this.#categoricalFacet("service"),
      model: MODEL_DEF,
      user: this.#categoricalFacet("user"),
      conversation: this.#categoricalFacet("conversation"),
      customer: this.#categoricalFacet("customer"),
      scenarioRun: META_FIELD_DEFS.scenarioRun,
      topic: this.#categoricalFacet("topic"),
      subtopic: this.#categoricalFacet("subtopic"),
      traceName: this.#categoricalFacet("traceName"),
      rootSpanType: this.#categoricalFacet("rootSpanType"),
      guardrail: this.#categoricalFacet("guardrail"),
      annotation: this.#categoricalFacet("annotation"),
      containsAi: this.#categoricalFacet("containsAi"),
      errorMessage: this.#categoricalFacet("errorMessage"),
      tokensEstimated: this.#categoricalFacet("tokensEstimated"),
      selectedPrompt: this.#categoricalFacet("selectedPrompt"),
      lastUsedPrompt: this.#categoricalFacet("lastUsedPrompt"),
      promptVersion: this.#rangeFacet("promptVersion"),
      label: LABEL_DEF,
      cost: this.#rangeFacet("cost"),
      duration: this.#rangeFacet("duration"),
      tokens: this.#rangeFacet("tokens"),
      ttft: this.#rangeFacet("ttft"),
      ttlt: this.#rangeFacet("ttlt"),
      promptTokens: this.#rangeFacet("promptTokens"),
      completionTokens: this.#rangeFacet("completionTokens"),
      tokensPerSecond: this.#rangeFacet("tokensPerSecond"),
      spans: this.#rangeFacet("spans"),
      size: this.#rangeFacet("size"),
      evaluator: EVALUATOR_DEF,
      evaluatorStatus: this.#crossCategoricalFacet(
        "evaluatorStatus",
        "evaluations",
        evaluatorStatusRead,
      ),
      evaluatorVerdict: this.#crossCategoricalFacet(
        "evaluatorVerdict",
        "evaluations",
        evaluatorVerdictRead,
      ),
      evaluatorScore: this.#crossRangeFacet("evaluatorScore", "evaluations", evaluatorScoreRead),
      evaluatorLabel: this.#crossCategoricalFacet(
        "evaluatorLabel",
        "evaluations",
        evaluatorLabelRead,
      ),
      spanType: this.#crossCategoricalFacet("spanType", "spans", spanTypeRead),
      spanName: this.#crossCategoricalFacet("spanName", "spans", spanNameRead),
      spanStatus: this.#crossCategoricalFacet("spanStatus", "spans", spanStatusRead),
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
    };
  }

  /** The registry facet `key` names, which must carry an SQL expression. */
  getExpressionFacet(key: string): ExpressionCategoricalDef | RangeFacetDef {
    const def = this.#facetByKey.get(key);
    if (!def) throw new Error(`facet '${key}' is missing from FACET_REGISTRY`);
    if (!("expression" in def)) {
      throw new Error(`facet '${key}' has no expression to derive a handler from`);
    }
    return def;
  }

  /** The time column `table` is windowed on. */
  getTimeColumn(table: keyof FacetCatalog["timeColumns"]): string {
    return this.#catalog.timeColumns[table];
  }

  /** Auto-derived `trace_summaries` categorical: direct equality + summary read. */
  #categoricalFacet(key: string): FieldDef {
    const def = this.getExpressionFacet(key);
    if (def.kind !== "categorical") {
      throw new Error(`facet '${key}' is not a categorical facet`);
    }
    if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
    return categorical(def.expression, def.read, def.key);
  }

  /** Auto-derived `trace_summaries` range: numeric comparison + summary read. */
  #rangeFacet(key: string): FieldDef {
    const def = this.getExpressionFacet(key);
    if (def.kind !== "range") {
      throw new Error(`facet '${key}' is not a range facet`);
    }
    if (!def.read) throw new Error(`facet '${key}' has no in-memory read`);
    return range(def.expression, def.read, def.key);
  }

  /** Cross-table categorical paired with per-collection in-memory read. */
  #crossCategoricalFacet(key: string, needs: FieldNeeds, read: CategoricalRead): FieldDef {
    const def = this.getExpressionFacet(key);
    if (def.kind !== "categorical") {
      throw new Error(`facet '${key}' is not a categorical facet`);
    }
    return crossTableCategorical({
      table: def.table,
      timeColumn: this.getTimeColumn(def.table),
      expression: def.expression,
      read,
      needs,
      name: def.key,
    });
  }

  #crossRangeFacet(key: string, needs: FieldNeeds, read: RangeRead): FieldDef {
    const def = this.getExpressionFacet(key);
    if (def.kind !== "range") {
      throw new Error(`facet '${key}' is not a range facet`);
    }
    return crossTableRange({
      table: def.table,
      timeColumn: this.getTimeColumn(def.table),
      expression: def.expression,
      read,
      needs,
      name: def.key,
    });
  }
}
