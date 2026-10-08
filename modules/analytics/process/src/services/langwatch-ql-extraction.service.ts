/**
 * The app-function and eval columns of a query answer: keys replaced by values, then the
 * columns that ask for it judged. Runs after the database answered and before diagnostics.
 * @see specs/lwql/api.feature
 */

import type {
  LangWatchQLCaller,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";

import { DEFAULT_LWQL_HYDRATION_LIMITS } from "../features/hydration/rules/langwatch-ql-hydration-assembly.rules.ts";
import {
  langWatchQLExtractionCalls,
  langWatchQLExtractionPlan,
} from "../features/hydration/rules/langwatch-ql-hydration-plan.rules.ts";
import type { LangWatchQLHydrationService } from "../features/hydration/services/langwatch-ql-hydration.service.ts";
import type { LangWatchQLAppFunctionDiagnosticsInput } from "../rules/langwatch-ql-diagnostics-shape.rules.ts";
import {
  computeLangWatchQLConversationFits,
  langWatchQLJudgedColumns,
  langWatchQLJudgementCalls,
  pickLangWatchQLConversationJudgements,
} from "../rules/langwatch-ql-judgement-questions.rules.ts";
import type { AcceptedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";

type LangWatchQLExtractionDependencies = {
  readonly hydration?: Pick<LangWatchQLHydrationService, "hydrate"> | undefined;
  readonly judging?: Pick<InstantEvalApi, "judgeQuery" | "getJudgeLimits"> | undefined;
};

export class LangWatchQLExtractionService {
  static create(deps: LangWatchQLExtractionDependencies): LangWatchQLExtractionService {
    return new LangWatchQLExtractionService(deps);
  }

  private constructor(private readonly deps: LangWatchQLExtractionDependencies) {}

  /**
   * Replaces each app-function key with its value, then has the eval columns judged on the text
   * left in place, as main's query did. A cancel fails the query once the spend is recorded.
   */
  async hydrate({
    projects,
    protections,
    validation,
    execution,
    signal,
  }: {
    readonly projects: readonly LangWatchQLCaller[];
    readonly protections: LangWatchQLProtections;
    readonly validation: Pick<AcceptedLangWatchQL, "appFunctions">;
    readonly execution: Pick<LangWatchQLQueryResult, "columns" | "rows">;
    readonly signal?: AbortSignal;
  }): Promise<
    Pick<LangWatchQLQueryResult, "columns" | "rows"> & {
      readonly appFunctions?: LangWatchQLAppFunctionDiagnosticsInput;
    }
  > {
    const { hydration, judging } = this.deps;
    const judgements = judging ? langWatchQLJudgementCalls(validation.appFunctions) : [];
    const calls =
      judgements.length > 0
        ? langWatchQLExtractionPlan(validation.appFunctions)
        : langWatchQLExtractionCalls(validation.appFunctions);
    if (!hydration || (calls.length === 0 && judgements.length === 0)) return execution;
    // Trimmed here, before judgeQuery, to the judge's own limits (Alex, 2026-10-08, CD-4).
    const isConversationJudged =
      judging !== undefined &&
      pickLangWatchQLConversationJudgements(validation.appFunctions).length > 0;
    const hydrated = await hydration.hydrate({
      projectIds: projects.map((project) => project.id),
      protections,
      calls,
      columns: execution.columns,
      rows: execution.rows,
      ...(signal ? { signal } : {}),
      ...(isConversationJudged
        ? {
            judgeFits: computeLangWatchQLConversationFits({
              calls: validation.appFunctions,
              limits: judging.getJudgeLimits(),
            }),
          }
        : {}),
    });
    const judged = await this.judge({ projects, judgements, rows: hydrated.rows, signal });

    return {
      columns: langWatchQLJudgedColumns({
        columns: hydrated.columns,
        appFunctions: judgements.length > 0 ? validation.appFunctions : [],
      }),
      rows: judged.rows,
      appFunctions: {
        isTruncatedByBytes: hydrated.isTruncatedByBytes,
        maxHydratedBytes: DEFAULT_LWQL_HYDRATION_LIMITS.maxHydratedBytes,
        rowsReturned: judged.rows.length,
        valueTruncations: hydrated.valueTruncations,
        unresolvedKeys: hydrated.unresolvedKeys,
        ...(judged.skipped ? { skippedJudgements: judged.skipped } : {}),
      },
    };
  }

  /**
   * The eval columns judged by instant-eval, which holds the budget and records the spend. The
   * gate admits an eval call for one project only, which is what gives the spend its owner.
   */
  private async judge({
    projects,
    judgements,
    rows,
    signal,
  }: {
    readonly projects: readonly LangWatchQLCaller[];
    readonly judgements: ReturnType<typeof langWatchQLJudgementCalls>;
    readonly rows: readonly Record<string, unknown>[];
    readonly signal?: AbortSignal;
  }): Promise<{
    rows: readonly Record<string, unknown>[];
    skipped?: Readonly<Record<string, number>>;
  }> {
    const [project, ...others] = projects;
    if (!this.deps.judging || judgements.length === 0) return { rows };
    if (!project || others.length > 0) {
      throw new Error("an eval function reached execution outside a single-project scope");
    }
    const judged = await this.deps.judging.judgeQuery({
      projectId: project.id,
      judgements,
      rows,
      ...(signal ? { signal } : {}),
    });
    if (judged.cancellation) {
      throw signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The query was cancelled", "AbortError");
    }

    return { rows: judged.rows, skipped: judged.skipped };
  }
}
