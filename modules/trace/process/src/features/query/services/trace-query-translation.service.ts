import type { ResolvedInstantEvalRun, TranslationContext } from "@langwatch/trace-contract";

import { translateEvaluationScope } from "../rules/trace-query-evaluation-scope.rules.ts";
import { translateFilterAst, translateTraceTag } from "../rules/trace-query.rules.ts";
import type { TraceQueryFieldsService } from "./trace-query-fields.service.ts";

/** Translates trace filters to ClickHouse SQL with value binding and free text. */
export class TraceQueryTranslationService {
  readonly #fields: TraceQueryFieldsService;

  static create({ fields }: { fields: TraceQueryFieldsService }): TraceQueryTranslationService {
    return new TraceQueryTranslationService(fields);
  }

  private constructor(fields: TraceQueryFieldsService) {
    this.#fields = fields;
  }

  /**
   * Translates a liqe query into a parameterized WHERE fragment or null.
   * `evalRuns` carries the runs registered for the query's `eval` chips.
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
        translateEvaluationScope({ scope, ctx: scopeCtx, fields: this.#fields }),
    });

    return sql === null ? null : { sql, params: ctx.params };
  }
}
