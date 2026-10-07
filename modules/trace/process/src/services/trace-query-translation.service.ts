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
   * Translates a liqe query into a parameterized WHERE fragment or null.
   * `evalRuns` carries the runs registered for the query's `eval` chips.
   */
  translateFilter({
    queryText,
    tenantId,
    timeRange,
    evalRuns,
  }: {
    queryText: string;
    tenantId: string;
    timeRange: { from: number; to: number };
    evalRuns?: readonly ResolvedInstantEvalRun[];
  }): { sql: string; params: Record<string, unknown> } | null {
    const ctx: TranslationContext = {
      paramCounter: 0,
      nodeCount: 0,
      params: {
        tenantId,
        timeFrom: timeRange.from,
        timeTo: timeRange.to,
      },
      tenantId,
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
