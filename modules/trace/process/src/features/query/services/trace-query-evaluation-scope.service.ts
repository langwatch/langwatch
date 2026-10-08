import {
  type InMemoryTrace,
  type TraceQueryEvaluationRun,
  type TranslationContext,
  UNSUPPORTED,
  type Unsupported,
} from "@langwatch/trace-contract";

import {
  type EvaluationScope,
  SCOPED_FACET_KEY_BY_FIELD,
  type ScopedCondition,
} from "../rules/trace-query-evaluation-scope.rules.ts";
import { latestEvaluationRunsSubquery } from "../rules/trace-query-subquery.rules.ts";
import {
  translateNumericField,
  translateStringField,
} from "../rules/trace-query-translators.rules.ts";
import {
  extractStringValue,
  nextParam,
  validateValueLength,
} from "../rules/trace-query-values.rules.ts";
import type { TraceQueryFieldsService } from "./trace-query-fields.service.ts";

/**
 * Compiles and evaluates an evaluator bound to its result conditions (the
 * group `buildAndChain` finds) over that evaluator's own latest runs.
 * @see https://github.com/langwatch/tasks/issues/918
 */
export class TraceQueryEvaluationScopeService {
  readonly #fields: TraceQueryFieldsService;

  static create({ fields }: { fields: TraceQueryFieldsService }): TraceQueryEvaluationScopeService {
    return new TraceQueryEvaluationScopeService(fields);
  }

  private constructor(fields: TraceQueryFieldsService) {
    this.#fields = fields;
  }

  /** The bound group as `evaluation_runs` subqueries over X's latest rows. */
  translateEvaluationScope(scope: EvaluationScope, ctx: TranslationContext): string {
    const evaluatorId = extractStringValue(scope.anchor);
    validateValueLength(evaluatorId);
    const p = nextParam(ctx, "evaluatorId");
    ctx.params[p] = evaluatorId;

    const runsOfX = (predicates: string[]): string =>
      latestEvaluationRunsSubquery({
        timeCol: this.#fields.getTimeColumn("evaluation_runs"),
        scopeWhere: `EvaluatorId = {${p}:String}`,
        innerWhere: predicates.length > 0 ? predicates.join(" AND ") : "1 = 1",
      });

    const keptSql = this.#keptGroups(scope).map(({ conditions, anyOf }) => {
      const joined = conditions
        .map((c) => this.#conditionSql(c, ctx))
        .join(anyOf ? " OR " : " AND ");
      return conditions.length > 1 ? `(${joined})` : joined;
    });
    const excluded = scope.conditions.filter((c) => c.negated);
    return [
      runsOfX(keptSql),
      ...excluded.map((c) => `NOT ${runsOfX([this.#conditionSql(c, ctx)])}`),
    ].join(" AND ");
  }

  /**
   * The bound group in memory, mirroring `translateEvaluationScope`. Each
   * condition reuses its field's own in-memory predicate over one evaluation, so
   * the two sides keep reading values the same way.
   */
  evaluateEvaluationScope(scope: EvaluationScope, trace: InMemoryTrace): boolean | Unsupported {
    if (trace.evaluations == null) return UNSUPPORTED;
    const evaluatorId = extractStringValue(scope.anchor);
    const runsOfX = trace.evaluations.filter(
      (evaluation) => evaluation.evaluatorId === evaluatorId,
    );
    const holds = (evaluation: TraceQueryEvaluationRun, c: ScopedCondition) =>
      this.#fields.fieldDefByName.get(c.field)?.evaluateInMemory(c.tag, false, {
        ...trace,
        evaluations: [evaluation],
      }) === true;

    const groups = this.#keptGroups(scope);
    const excluded = scope.conditions.filter((c) => c.negated);
    return (
      runsOfX.some((evaluation) =>
        groups.every(({ conditions, anyOf }) =>
          anyOf
            ? conditions.some((c) => holds(evaluation, c))
            : conditions.every((c) => holds(evaluation, c)),
        ),
      ) && !excluded.some((c) => runsOfX.some((evaluation) => holds(evaluation, c)))
    );
  }

  /**
   * The kept conditions grouped by facet, in first-seen order. A categorical
   * group is a set of alternatives (`anyOf`); a range group is joined.
   */
  #keptGroups(scope: EvaluationScope): { conditions: ScopedCondition[]; anyOf: boolean }[] {
    const groups = new Map<string, { conditions: ScopedCondition[]; anyOf: boolean }>();
    for (const condition of scope.conditions) {
      if (condition.negated) continue;
      const facet = this.#scopedFacet(condition.field);
      const group = groups.get(facet.key) ?? {
        conditions: [],
        anyOf: facet.kind !== "range",
      };
      group.conditions.push(condition);
      groups.set(facet.key, group);
    }
    return [...groups.values()];
  }

  /**
   * A condition's predicate on one `evaluation_runs` row, always in its kept
   * form: an excluded condition is applied by excluding the rows it matches. A
   * NULL column (no score, no label) matches no row either way.
   */
  #conditionSql({ tag, field }: ScopedCondition, ctx: TranslationContext): string {
    const facet = this.#scopedFacet(field);
    const args = { columnExpr: facet.expression, tag, negated: false, ctx, name: facet.key };
    return facet.kind === "range" ? translateNumericField(args) : translateStringField(args);
  }

  #scopedFacet(field: string) {
    return this.#fields.getExpressionFacet(SCOPED_FACET_KEY_BY_FIELD.get(field) ?? field);
  }
}
