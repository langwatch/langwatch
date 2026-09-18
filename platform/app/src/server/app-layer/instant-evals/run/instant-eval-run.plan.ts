/**
 * Planning a run: how many rows it will judge, and how large a page should be.
 *
 * Two reads and no judging. The count bounds the selection, and a sample of
 * the first rows' text decides the page size, because a page of long threads
 * is the same number of classifications and several times the memory.
 *
 * @see ./instant-eval-run.executor.ts: the step that calls this
 * @see ./composition.ts: the count and key statements it runs
 */

import type {
  InstantEvalPlan,
  InstantEvalRunPort,
} from "~/server/event-sourcing/pipelines/instant-eval-processing/process-manager";
import {
  type InstantEvalRunExecutorDependencies,
  instantEvalAverageTextBytes,
  instantEvalHydrationPlan,
  instantEvalKeyCapFor,
  instantEvalPageSizeFor,
  loadRun,
} from "./instant-eval-run.executor";
import { instantEvalKeyColumns } from "./row-source";

/** Rows a plan measures the text size of. */
export const INSTANT_EVAL_SAMPLE_ROWS = 50;

/** What the run is about to do, learned without judging anything. */
export async function planRun(
  deps: InstantEvalRunExecutorDependencies,
  { runId, projectId }: Parameters<InstantEvalRunPort["plan"]>[0],
): Promise<InstantEvalPlan> {
  const { row, caller, questions, parameters } = await loadRun({
    deps,
    projectId,
    runId,
  });
  const columns = await deps.rowSource.probe({
    caller,
    sql: row.sql,
    parameters,
  });
  const keyColumns = instantEvalKeyColumns(columns);

  // A count, not a key read. Reading the whole selection's keys to learn its
  // size hits the executor's byte ceiling somewhere above eighty thousand
  // rows, and that ceiling truncates silently: the run would report a smaller
  // total, call itself uncapped, and finish early looking successful. The
  // count is bounded one past the limit, so a total equal to that bound is a
  // capped run and anything below it is the whole selection.
  const total = await deps.rowSource.count({
    caller,
    sql: row.sql,
    parameters,
    limit: row.rowLimit + 1,
  });
  const isCapped = total > row.rowLimit;

  // A spread of the selection's texts, read without judging any of them, which
  // is what the page size is chosen from. Spread rather than the first rows for
  // the same reason the estimate is: the statement's own order correlates with
  // row length, so a head sample sizes the page for the wrong rows.
  const sample =
    total === 0
      ? []
      : await sampleTexts({
          deps,
          row,
          caller,
          parameters,
          keyColumns,
          projectId,
          total: Math.min(total, row.rowLimit),
        });
  const averageTextBytes = instantEvalAverageTextBytes({
    rows: sample,
    questionIds: questions.map((question) => question.id),
  });

  return {
    total: Math.min(total, row.rowLimit),
    pageSize: instantEvalPageSizeFor(
      averageTextBytes,
      instantEvalKeyCapFor(instantEvalHydrationPlan(row.plan)),
    ),
    isCapped,
    keyColumns,
  };
}

/** A spread of the selection's judged text, read without judging any of it. */
async function sampleTexts({
  deps,
  row,
  caller,
  parameters,
  keyColumns,
  projectId,
  total,
}: {
  deps: InstantEvalRunExecutorDependencies;
  row: { sql: string; plan: unknown };
  caller: { id: string; lwqlKey: string };
  parameters: Record<string, unknown>;
  keyColumns: readonly string[];
  projectId: string;
  total: number;
}): Promise<readonly Record<string, unknown>[]> {
  const keys = await deps.rowSource.sampleKeys({
    caller,
    sql: row.sql,
    parameters,
    keyColumns,
    limit: INSTANT_EVAL_SAMPLE_ROWS,
    total,
  });
  if (keys.length === 0) return [];
  return await deps.rowSource.texts({
    caller,
    protections: await deps.protections(projectId),
    sql: row.sql,
    parameters,
    calls: instantEvalHydrationPlan(row.plan),
    traceIds: [...new Set(keys.map((key) => key.traceId))],
  });
}
