import type { ResolvedInstantEvalRun, TranslationContext } from "@langwatch/trace-contract";

import { translateFilterAst, translateTraceTag } from "../rules/trace-query.rules.ts";
import type { TraceQueryEvaluationScopeService } from "./trace-query-evaluation-scope.service.ts";
import type { TraceQueryFieldsService } from "./trace-query-fields.service.ts";

/** Translates trace filters to ClickHouse SQL with value binding and free text. */
export class TraceQueryTranslationService {
  readonly #fields: TraceQueryFieldsService;
  readonly #evaluationScope: TraceQueryEvaluationScopeService;

  static create({
    fields,
    evaluationScope,
  }: {
    fields: TraceQueryFieldsService;
    evaluationScope: TraceQueryEvaluationScopeService;
  }): TraceQueryTranslationService {
    return new TraceQueryTranslationService(fields, evaluationScope);
  }

  private constructor(
    fields: TraceQueryFieldsService,
    evaluationScope: TraceQueryEvaluationScopeService,
  ) {
    this.#fields = fields;
    this.#evaluationScope = evaluationScope;
  }

  /**
   * A liqe query as a parameterized WHERE fragment, or null; `evalRuns` backs its `eval` chips.
   * It names no tenant: each subquery carries a marker the authorized reader expands into the
   * proof's fence (ADR-175), so the statement it lands in decides who is in scope.
   */
  translateFilter({
    queryText,
    timeRange,
    evalRuns,
  }: {
    queryText: string;
    timeRange: { from: number; to: number };
    evalRuns?: readonly ResolvedInstantEvalRun[];
  }): { sql: string; params: Record<string, unknown> } | null {
    const ctx: TranslationContext = {
      paramCounter: 0,
      nodeCount: 0,
      params: {
        timeFrom: timeRange.from,
        timeTo: timeRange.to,
      },
      timeRange,
      ...(evalRuns ? { evalRuns } : {}),
    };

    const sql = translateFilterAst({
      queryText,
      ctx,
      translateTag: (tag, negated, tagCtx) =>
        translateTraceTag({ tag, negated, ctx: tagCtx, fieldDefs: this.#fields.fieldDefByName }),
      translateScope: (scope, scopeCtx) =>
        this.#evaluationScope.translateEvaluationScope(scope, scopeCtx),
    });

    return sql === null ? null : { sql, params: ctx.params };
  }
}
