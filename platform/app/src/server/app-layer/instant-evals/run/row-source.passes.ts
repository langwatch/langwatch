/**
 * The eight reads a run performs, each one a wrapper around the caller's own
 * statement.
 *
 * Separate from `./row-source.ts`, which holds the contract and the types,
 * because this is where the two rules that make a read safe live: a result the
 * executor cut short at its byte ceiling is an error rather than a shorter
 * answer, and a row a page does not own is dropped before anything is judged.
 *
 * @see ./row-source.ts
 * @see ./composition.ts: the statements these run
 * @see ../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import type {
  judgeLangWatchQLHydration,
  LangWatchQLAppFunctionCall,
  LangWatchQLColumn,
  LangWatchQLExecutor,
  LangWatchQLPreparedHydration,
} from "~/server/analytics/lwql";
import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_AFTER_SPAN_PARAMETER,
  INSTANT_EVAL_PAGE_PARAMETER,
  INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER,
  INSTANT_EVAL_SPAN_COLUMN,
  INSTANT_EVAL_TRACE_COLUMN,
  instantEvalCountSql,
  instantEvalKeyPassSql,
  instantEvalPagePassSql,
  instantEvalPagesBySpan,
  instantEvalProbeSql,
  instantEvalSampleBuckets,
  instantEvalSampleKeysSql,
} from "./composition";
import {
  type InstantEvalPreparedPage,
  InstantEvalResultTruncatedError,
  type InstantEvalRowKey,
  type InstantEvalRowSource,
  type InstantEvalRunCaller,
  instantEvalTextPlan,
} from "./row-source";

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Epoch milliseconds from whatever shape the column came back as. */
function occurredAtOf(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value === "") return null;
  const parsed = Date.parse(value.includes("T") ? value : `${value}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function toRowKey(row: Record<string, unknown>): InstantEvalRowKey {
  return {
    traceId: textOf(row[INSTANT_EVAL_TRACE_COLUMN]),
    threadId: textOf(row.ThreadId),
    spanId: textOf(row.SpanId),
    occurredAt: occurredAtOf(row.OccurredAt),
  };
}

/**
 * Rows one page pass may read before it is refused.
 *
 * A page owns at most `INSTANT_EVAL_PAGE_SIZE` keys, but its predicate is on
 * the trace ids of those keys, so a trace whose spans straddle the page
 * boundary brings its other span rows along. Ten times the largest page is
 * room for a fan-out of ten spans per trace across the whole page, and past
 * that the statement is too wide to page this way and says so rather than
 * quietly judging a truncated page.
 */
export const INSTANT_EVAL_PAGE_ROW_CEILING = 5_000;

/**
 * What one pass read, with the fact every pass has to check before trusting it.
 *
 * `truncated` is decided here rather than by the executor, which returns every
 * row the database gave it: a pass asks for a bounded number of rows and a
 * result above that bound means the selection outgrew what the pass can own.
 * Reading a cut page as if it were whole is the one failure a run cannot
 * detect afterwards, so each pass refuses instead.
 */
export type InstantEvalPassExecution = Awaited<
  ReturnType<LangWatchQLExecutor["execute"]>
> & { readonly truncated: boolean };

/**
 * The three operations every pass is built from, closed over one caller's
 * executor: the statement, the read half of hydration, and the judge half.
 */
export interface InstantEvalPasses {
  run(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    maxRows: number;
  }): Promise<InstantEvalPassExecution>;
  prepare(input: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    calls: readonly LangWatchQLAppFunctionCall[];
    execution: Awaited<ReturnType<LangWatchQLExecutor["execute"]>>;
    instantEvals?: {
      classifier: InstantEvalClassifier;
      maxConcurrency: number;
      queryTokenBudget: number;
    };
  }): Promise<LangWatchQLPreparedHydration>;
  judge(input: {
    prepared: LangWatchQLPreparedHydration;
    signal?: AbortSignal;
  }): Promise<Awaited<ReturnType<typeof judgeLangWatchQLHydration>>>;
}

/** What the statement projects, learned without reading a row. */
export async function probePass(
  passes: InstantEvalPasses,
  { caller, sql, parameters }: Parameters<InstantEvalRowSource["probe"]>[0],
): Promise<readonly LangWatchQLColumn[]> {
  const execution = await passes.run({
    caller,
    sql: instantEvalProbeSql(sql),
    ...(parameters ? { parameters } : {}),
    maxRows: 1,
  });
  return execution.columns;
}

/** How many rows the statement matches, bounded by the caller's own limit. */
export async function countPass(
  passes: InstantEvalPasses,
  {
    caller,
    sql,
    parameters,
    limit,
  }: Parameters<InstantEvalRowSource["count"]>[0],
): Promise<number> {
  const execution = await passes.run({
    caller,
    sql: instantEvalCountSql({ sql, limit }),
    ...(parameters ? { parameters } : {}),
    maxRows: 1,
  });
  if (execution.truncated) throw new InstantEvalResultTruncatedError("count");
  const total = execution.rows[0]?.total;
  if (typeof total === "number") return total;
  // ClickHouse renders a UInt64 as a decimal string in JSON, which is what a
  // count comes back as on every path that matters here.
  const parsed = typeof total === "string" ? Number.parseInt(total, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One page of row keys, and whether another page follows. */
export async function keyPass(
  passes: InstantEvalPasses,
  {
    caller,
    sql,
    parameters,
    keyColumns,
    limit,
    after,
  }: Parameters<InstantEvalRowSource["keys"]>[0],
): ReturnType<InstantEvalRowSource["keys"]> {
  // One row past the page, which is how "there is more" is learned without a
  // second count over the same statement.
  const probeLimit = limit + 1;
  const bySpan = instantEvalPagesBySpan(keyColumns);
  const execution = await passes.run({
    caller,
    sql: instantEvalKeyPassSql({
      sql,
      keyColumns,
      limit: probeLimit,
      hasCursor: after !== undefined,
    }),
    parameters: {
      ...parameters,
      ...(after === undefined
        ? {}
        : {
            [INSTANT_EVAL_AFTER_PARAMETER]: after.traceId,
            ...(bySpan
              ? { [INSTANT_EVAL_AFTER_SPAN_PARAMETER]: after.spanId ?? "" }
              : {}),
          }),
    },
    maxRows: probeLimit,
  });
  if (execution.truncated) throw new InstantEvalResultTruncatedError("key");
  return {
    keys: execution.rows.slice(0, limit).map(toRowKey),
    hasMore: execution.rows.length > limit,
  };
}

/** A sample of the selection's keys, spread across the whole of it. */
export async function sampleKeysPass(
  passes: InstantEvalPasses,
  {
    caller,
    sql,
    parameters,
    keyColumns,
    limit,
    total,
  }: Parameters<InstantEvalRowSource["sampleKeys"]>[0],
): Promise<readonly InstantEvalRowKey[]> {
  const execution = await passes.run({
    caller,
    sql: instantEvalSampleKeysSql({ sql, keyColumns, limit }),
    parameters: {
      ...parameters,
      [INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER]: instantEvalSampleBuckets({
        total,
        limit,
      }),
    },
    maxRows: limit,
  });
  return execution.rows.map(toRowKey);
}

/** One page of rows, read and extracted, with nothing judged. */
export async function readPass(
  passes: InstantEvalPasses,
  {
    caller,
    protections,
    sql,
    parameters,
    calls,
    keys,
    classifier,
    maxConcurrency,
  }: Parameters<InstantEvalRowSource["read"]>[0],
): Promise<InstantEvalPreparedPage> {
  const traceIds = [...new Set(keys.map((key) => key.traceId))];
  const startedQuery = Date.now();
  const execution = await passes.run({
    caller,
    sql: instantEvalPagePassSql(sql),
    parameters: { ...parameters, [INSTANT_EVAL_PAGE_PARAMETER]: traceIds },
    maxRows: INSTANT_EVAL_PAGE_ROW_CEILING,
  });
  const queryMs = Date.now() - startedQuery;
  if (execution.truncated) throw new InstantEvalResultTruncatedError("page");

  // Rows of a trace the page shares with its neighbour are dropped here: the
  // predicate could only name the trace, so the page read them and does not
  // own them. Judging happens after this, so a dropped row is never paid for.
  const owned = instantEvalOwnedRows({ rows: execution.rows, keys });

  const hydration = await passes.prepare({
    caller,
    protections,
    calls,
    execution: { ...execution, rows: owned },
    instantEvals: {
      classifier,
      maxConcurrency,
      // A page is already bounded by its own size, so the budget is only a
      // backstop against a page of texts far larger than the classifier
      // takes: whatever the whole page could carry at the state cap.
      queryTokenBudget:
        Math.max(1, owned.length) * classifier.limits.stateTokens,
    },
  });
  return { rows: owned.length, queryMs, hydration };
}

/** Judges a page {@link readPass} prepared. */
export async function judgePreparedPass(
  passes: InstantEvalPasses,
  { page, signal }: Parameters<InstantEvalRowSource["judgePrepared"]>[0],
): ReturnType<InstantEvalRowSource["judgePrepared"]> {
  const hydration = await passes.judge({
    prepared: page.hydration,
    ...(signal ? { signal } : {}),
  });
  return {
    columns: hydration.columns,
    rows: hydration.rows,
    usage: hydration.evalUsage ?? {
      requests: 0,
      inputTokens: 0,
      skipped: {},
      limiterWaitMs: 0,
    },
    timings: {
      queryMs: page.queryMs,
      readMs: hydration.timings?.readMs ?? 0,
      computeMs: hydration.timings?.computeMs ?? 0,
      judgeMs: hydration.timings?.judgeMs ?? 0,
    },
  };
}

/** One page of rows, judged: the read, then the judging. */
export async function judgePass(
  passes: InstantEvalPasses,
  { signal, ...input }: Parameters<InstantEvalRowSource["judge"]>[0],
): ReturnType<InstantEvalRowSource["judge"]> {
  const page = await readPass(passes, input);
  return await judgePreparedPass(passes, {
    page,
    ...(signal ? { signal } : {}),
  });
}

/**
 * The rows of a page read that the page actually owns.
 *
 * Matched on the trace and span pair when the page is keyed by both, and on
 * the trace alone otherwise, which is also the shape of the judgement key. A
 * statement with several rows per trace and no `SpanId` cannot be told apart
 * row by row, so every row of a named trace is kept and the judgement key
 * collapses them, which is the grain such a statement asked for.
 */
export function instantEvalOwnedRows({
  rows,
  keys,
}: {
  readonly rows: readonly Record<string, unknown>[];
  readonly keys: readonly InstantEvalRowKey[];
}): Record<string, unknown>[] {
  const bySpan = keys.some((key) => key.spanId !== "");
  const owned = new Set(
    keys.map((key) =>
      bySpan ? `${key.traceId}\u0000${key.spanId}` : key.traceId,
    ),
  );
  return rows.filter((row) => {
    const traceId = textOf(row[INSTANT_EVAL_TRACE_COLUMN]);
    const wanted = bySpan
      ? `${traceId}\u0000${textOf(row[INSTANT_EVAL_SPAN_COLUMN])}`
      : traceId;
    return owned.has(wanted);
  });
}

/** The same page's rows with their text extracted and nothing judged. */
export async function textPass(
  passes: InstantEvalPasses,
  {
    caller,
    protections,
    sql,
    parameters,
    calls,
    traceIds,
  }: Parameters<InstantEvalRowSource["texts"]>[0],
): ReturnType<InstantEvalRowSource["texts"]> {
  const execution = await passes.run({
    caller,
    sql: instantEvalPagePassSql(sql),
    parameters: { ...parameters, [INSTANT_EVAL_PAGE_PARAMETER]: traceIds },
    maxRows: INSTANT_EVAL_PAGE_ROW_CEILING,
  });
  const hydration = await passes.judge({
    prepared: await passes.prepare({
      caller,
      protections,
      calls: instantEvalTextPlan(calls),
      execution,
    }),
  });
  return hydration.rows;
}
