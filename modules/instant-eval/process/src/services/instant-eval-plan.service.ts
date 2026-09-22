/**
 * Planning a run: how many rows it will judge, and how large a page should be.
 * Two reads and no judging, because a page of long threads costs more memory.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { LangWatchQLAppFunctionCall } from "@langwatch/analytics-contract";

import type { InstantEvalPlan } from "../eventing/instant-eval-processing.intent.ts";
import { instantEvalKeyColumns } from "../rules/instant-eval-composition.rules.ts";
import {
  instantEvalAverageTextBytes,
  instantEvalHydrationPlan,
  instantEvalPageSizeFor,
  INSTANT_EVAL_SAMPLE_ROWS,
} from "../rules/instant-eval-run-sizing.rules.ts";
import type { InstantEvalTextSource } from "./instant-eval-estimate.service.ts";
import type { InstantEvalRowSourceService } from "./instant-eval-row-source.service.ts";
import type {
  InstantEvalLoadedRun,
  InstantEvalRunContextService,
} from "./instant-eval-run-context.service.ts";

/** The Analytics peer, narrowed to the one question the page size asks it. */
export interface InstantEvalKeyCapSource {
  langWatchQLKeyCapFor(input: { appFunctions: readonly LangWatchQLAppFunctionCall[] }): number;
}

export class InstantEvalPlanService {
  private constructor(
    private readonly context: InstantEvalRunContextService,
    private readonly rowSource: Pick<InstantEvalRowSourceService, "probe" | "count" | "sampleKeys">,
    private readonly textSource: InstantEvalTextSource,
    private readonly keyCaps: InstantEvalKeyCapSource,
  ) {}

  static create({
    context,
    rowSource,
    textSource,
    keyCaps,
  }: {
    context: InstantEvalRunContextService;
    rowSource: Pick<InstantEvalRowSourceService, "probe" | "count" | "sampleKeys">;
    textSource: InstantEvalTextSource;
    keyCaps: InstantEvalKeyCapSource;
  }): InstantEvalPlanService {
    return new InstantEvalPlanService(context, rowSource, textSource, keyCaps);
  }

  /** What the run is about to do, learned without judging anything. */
  async plan({ runId, projectId }: { runId: string; projectId: string }): Promise<InstantEvalPlan> {
    const loaded = await this.context.load({ projectId, runId });
    const { row, caller, protections, questions, parameters } = loaded;
    const columns = await this.rowSource.probe({
      caller,
      protections,
      sql: row.sql,
      parameters,
    });
    const keyColumns = instantEvalKeyColumns(columns);

    // A count, not a key read: reading a whole selection's keys to learn its
    // size passes the executor's byte ceiling, which truncates silently, and
    // the run would report a smaller total and finish early looking successful.
    // Bounded one past the limit, so a total equal to that bound is capped.
    const total = await this.rowSource.count({
      caller,
      protections,
      sql: row.sql,
      parameters,
      limit: row.rowLimit + 1,
    });
    const bounded = Math.min(total, row.rowLimit);
    const sample =
      bounded === 0 ? [] : await this.#sampleTexts({ loaded, keyColumns, total: bounded });

    return {
      total: bounded,
      pageSize: instantEvalPageSizeFor({
        averageTextBytes: instantEvalAverageTextBytes({
          rows: sample,
          questionIds: questions.map((question) => question.id),
        }),
        keyCap: this.keyCaps.langWatchQLKeyCapFor({
          appFunctions: instantEvalHydrationPlan(row.plan),
        }),
      }),
      isCapped: total > row.rowLimit,
      keyColumns,
    };
  }

  /**
   * A spread of the selection's judged text, read without judging any of it.
   * Spread rather than the first rows: a statement's own order correlates with
   * row length, so a head sample sizes the page for the wrong rows.
   */
  async #sampleTexts({
    loaded,
    keyColumns,
    total,
  }: {
    loaded: InstantEvalLoadedRun;
    keyColumns: readonly string[];
    total: number;
  }): Promise<readonly Record<string, unknown>[]> {
    const { row, caller, protections, parameters } = loaded;
    const keys = await this.rowSource.sampleKeys({
      caller,
      protections,
      sql: row.sql,
      parameters,
      keyColumns,
      limit: INSTANT_EVAL_SAMPLE_ROWS,
      total,
    });
    const traceIds = [...new Set(keys.map((key) => key.traceId))];
    if (traceIds.length === 0) return [];

    return this.textSource.texts({
      project: caller,
      protections,
      sql: row.sql,
      parameters,
      calls: instantEvalHydrationPlan(row.plan),
      traceIds,
    });
  }
}
