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
   * A liqe query as a parameterized WHERE fragment, or null. `searchContent` false and
   * `isHiddenAttribute` keep a protected viewer's filter off what they may not read.
   */
  translateFilter({
    queryText,
    timeRange,
    evalRuns,
    searchContent = true,
    isHiddenAttribute,
  }: {
    queryText: string;
    timeRange: { from: number; to: number };
    evalRuns?: readonly ResolvedInstantEvalRun[];
    searchContent?: boolean;
    isHiddenAttribute?: (key: string) => boolean;
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
        translateTraceTag({
          tag,
          negated,
          ctx: tagCtx,
          fieldDefs: this.#fields.fieldDefByName,
          searchContent,
          ...(isHiddenAttribute ? { isHiddenAttribute } : {}),
        }),
      translateScope: (scope, scopeCtx) =>
        translateEvaluationScope({ scope, ctx: scopeCtx, fields: this.#fields }),
    });

    return sql === null ? null : { sql, params: ctx.params };
  }
}
