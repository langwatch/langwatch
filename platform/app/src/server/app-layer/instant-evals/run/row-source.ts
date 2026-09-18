/**
 * Where a run's rows come from, and where its judgements are made.
 *
 * One seam over the LangWatchQL execution path, holding the three reads a run
 * performs and nothing else. It is a seam rather than a direct call for the
 * usual reason plus one that matters more here: a page of this is a page of
 * spend, so a suite has to be able to drive the whole loop against a fake
 * classifier and a fake executor without a datastore and without a bill.
 *
 * It runs as the same restricted database identity the synchronous API runs as,
 * with the caller's own tenant capability, so the row policy bounds a job
 * exactly as it bounds a query. Hydration goes through the same stage, with the
 * caller's `Protections`, so a run reads no content a query would have withheld.
 *
 * What it does NOT do is record cost. The synchronous path writes one cost row
 * per query; a run writes one per run, so the usage each page reports is handed
 * back to the caller and summed there.
 *
 * @see ./composition.ts: the statements it runs
 * @see ~/server/analytics/lwql/lwql.service.ts: the verbatim path this mirrors
 */

import {
  createLangWatchQLAppFunctionTraceSource,
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  hydrateLangWatchQLAppFunctions,
  type LangWatchQLAppFunctionCall,
  type LangWatchQLAppFunctionTraceSource,
  type LangWatchQLColumn,
  type LangWatchQLEvalUsage,
  type LangWatchQLExecutor,
  lwqlAppFunction,
  lwqlConnectionFromEnv,
  lwqlTenantCapability,
} from "~/server/analytics/lwql";
import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_OPTIONAL_KEY_COLUMNS,
  INSTANT_EVAL_PAGE_PARAMETER,
  INSTANT_EVAL_TRACE_COLUMN,
  instantEvalKeyPassSql,
  instantEvalPagePassSql,
  instantEvalProbeSql,
} from "./composition";

/** The tenant a run reads as. The same two fields the query service needs. */
export interface InstantEvalRunCaller {
  readonly id: string;
  /** `Project.lwqlKey`, hashed into the tenant capability. Never logged. */
  readonly lwqlKey: string;
}

/** One row's identity, as the key pass found it. */
export interface InstantEvalRowKey {
  readonly traceId: string;
  readonly threadId: string;
  readonly spanId: string;
  /** Epoch milliseconds, or null when the statement projects no time column. */
  readonly occurredAt: number | null;
}

/** What one page of keys found, and whether more follow it. */
export interface InstantEvalKeyPage {
  readonly keys: readonly InstantEvalRowKey[];
  readonly hasMore: boolean;
}

/** One page of judged rows, and what judging them spent. */
export interface InstantEvalJudgedPage {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly usage: LangWatchQLEvalUsage;
}

export interface InstantEvalRowSource {
  /** What the statement projects, without reading a row or judging anything. */
  probe(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
  }): Promise<readonly LangWatchQLColumn[]>;

  /** One page of row keys, after the id the previous page ended on. */
  keys(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    /** Optional key columns the statement projects, from {@link probe}. */
    keyColumns: readonly string[];
    limit: number;
    afterTraceId?: string;
  }): Promise<InstantEvalKeyPage>;

  /** One page of rows, judged. */
  judge(input: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    /** The hydration plan the validator recorded for the inner statement. */
    calls: readonly LangWatchQLAppFunctionCall[];
    traceIds: readonly string[];
    classifier: InstantEvalClassifier;
    maxConcurrency: number;
    signal?: AbortSignal;
  }): Promise<InstantEvalJudgedPage>;

  /**
   * One page of rows with the judged columns holding the text that was judged
   * instead of the verdict.
   *
   * The same read, hydrated against a plan whose eval calls are replaced by the
   * extraction they were written over, so no classifier is called and nothing
   * is charged. That is what makes a sample safe to take repeatedly: reading
   * what a run judged must not cost what judging it cost.
   */
  texts(input: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    calls: readonly LangWatchQLAppFunctionCall[];
    traceIds: readonly string[];
  }): Promise<readonly Record<string, unknown>[]>;
}

/**
 * The extraction half of a judged plan.
 *
 * An eval call written over an extraction function becomes that extraction
 * function, landing in the same column. An eval call written over a plain
 * expression is dropped, because the column already holds the text: the
 * database's identity UDF left it there and there is nothing to read.
 */
export function instantEvalTextPlan(
  calls: readonly LangWatchQLAppFunctionCall[],
): readonly LangWatchQLAppFunctionCall[] {
  const plan: LangWatchQLAppFunctionCall[] = [];
  for (const call of calls) {
    const definition = lwqlAppFunction(call.function);
    if (!definition) continue;
    if (definition.kind !== "eval") {
      plan.push(call);
      continue;
    }
    if (!call.source) continue;
    plan.push({
      column: call.column,
      function: call.source.function,
      options: call.source.options,
    });
  }
  return plan;
}

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

/** The optional key columns a probe's column list actually offers. */
export function instantEvalKeyColumns(
  columns: readonly LangWatchQLColumn[],
): readonly string[] {
  const present = new Set(columns.map((column) => column.name));
  return INSTANT_EVAL_OPTIONAL_KEY_COLUMNS.filter((column) =>
    present.has(column),
  );
}

export interface InstantEvalRowSourceDependencies {
  /** How the run reaches the database, or `null` on a deployment with none. */
  readonly executor: LangWatchQLExecutor | null;
  readonly traceSource?: LangWatchQLAppFunctionTraceSource;
}

/** Raised when the deployment has no restricted identity to run a job as. */
export class InstantEvalRowSourceUnavailableError extends Error {
  constructor() {
    super("no LangWatchQL identity is provisioned");
    this.name = "InstantEvalRowSourceUnavailableError";
  }
}

/**
 * An executor for the run, or `null` on a deployment with no LangWatchQL
 * identity.
 *
 * A second executor beside the query service's own, because the two hold
 * separate connection pools with separate lifetimes: a worker process runs jobs
 * and never answers a query, and a web process is the other way round.
 */
export function instantEvalExecutorFromEnv(): LangWatchQLExecutor | null {
  const connection = lwqlConnectionFromEnv();
  return connection ? createLangWatchQLExecutor(connection) : null;
}

export function createInstantEvalRowSource(
  dependencies: InstantEvalRowSourceDependencies = {
    executor: instantEvalExecutorFromEnv(),
  },
): InstantEvalRowSource {
  let cachedTraceSource: LangWatchQLAppFunctionTraceSource | undefined;
  const traceSource = () =>
    (cachedTraceSource ??=
      dependencies.traceSource ?? createLangWatchQLAppFunctionTraceSource());

  const executorOrRefuse = (): LangWatchQLExecutor => {
    if (!dependencies.executor)
      throw new InstantEvalRowSourceUnavailableError();
    return dependencies.executor;
  };

  const run = async ({
    caller,
    sql,
    parameters,
    maxRows,
  }: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    maxRows: number;
  }) =>
    await executorOrRefuse().execute({
      sql,
      ...(parameters && Object.keys(parameters).length > 0
        ? { parameters }
        : {}),
      tenantCapability: lwqlTenantCapability({ secret: caller.lwqlKey }),
      limits: { ...DEFAULT_LWQL_RESULT_LIMITS, maxRows },
      usesAppFunctions: true,
    });

  const hydrate = async ({
    caller,
    protections,
    calls,
    execution,
    instantEvals,
    signal,
  }: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    calls: readonly LangWatchQLAppFunctionCall[];
    execution: Awaited<ReturnType<LangWatchQLExecutor["execute"]>>;
    instantEvals?: {
      classifier: InstantEvalClassifier;
      maxConcurrency: number;
      queryTokenBudget: number;
    };
    signal?: AbortSignal;
  }) =>
    await hydrateLangWatchQLAppFunctions({
      projectId: caller.id,
      protections,
      calls,
      columns: execution.columns,
      rows: execution.rows,
      limits: DEFAULT_LWQL_RESULT_LIMITS,
      traceSource: traceSource(),
      ...(instantEvals ? { instantEvals } : {}),
      ...(signal ? { signal } : {}),
    });

  const passes: InstantEvalPasses = { run, hydrate };

  return {
    probe: (input) => probePass(passes, input),
    keys: (input) => keyPass(passes, input),
    judge: (input) => judgePass(passes, input),
    texts: (input) => textPass(passes, input),
  };
}

/** The two reads every pass is built from, closed over one caller's executor. */
interface InstantEvalPasses {
  run(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    maxRows: number;
  }): Promise<Awaited<ReturnType<LangWatchQLExecutor["execute"]>>>;
  hydrate(input: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    calls: readonly LangWatchQLAppFunctionCall[];
    execution: Awaited<ReturnType<LangWatchQLExecutor["execute"]>>;
    instantEvals?: {
      classifier: InstantEvalClassifier;
      maxConcurrency: number;
      queryTokenBudget: number;
    };
    signal?: AbortSignal;
  }): Promise<Awaited<ReturnType<typeof hydrateLangWatchQLAppFunctions>>>;
}

/** What the statement projects, learned without reading a row. */
async function probePass(
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

/** One page of row keys, and whether another page follows. */
async function keyPass(
  passes: InstantEvalPasses,
  {
    caller,
    sql,
    parameters,
    keyColumns,
    limit,
    afterTraceId,
  }: Parameters<InstantEvalRowSource["keys"]>[0],
): ReturnType<InstantEvalRowSource["keys"]> {
  // One row past the page, which is how "there is more" is learned without a
  // second count over the same statement.
  const probeLimit = limit + 1;
  const execution = await passes.run({
    caller,
    sql: instantEvalKeyPassSql({
      sql,
      keyColumns,
      limit: probeLimit,
      hasCursor: afterTraceId !== undefined,
    }),
    parameters: {
      ...parameters,
      ...(afterTraceId === undefined
        ? {}
        : { [INSTANT_EVAL_AFTER_PARAMETER]: afterTraceId }),
    },
    maxRows: probeLimit,
  });
  return {
    keys: execution.rows.slice(0, limit).map(toRowKey),
    hasMore: execution.rows.length > limit,
  };
}

/** One page of rows, judged. */
async function judgePass(
  passes: InstantEvalPasses,
  {
    caller,
    protections,
    sql,
    parameters,
    calls,
    traceIds,
    classifier,
    maxConcurrency,
    signal,
  }: Parameters<InstantEvalRowSource["judge"]>[0],
): ReturnType<InstantEvalRowSource["judge"]> {
  const execution = await passes.run({
    caller,
    sql: instantEvalPagePassSql(sql),
    parameters: { ...parameters, [INSTANT_EVAL_PAGE_PARAMETER]: traceIds },
    maxRows: traceIds.length,
  });
  const hydration = await passes.hydrate({
    caller,
    protections,
    calls,
    execution,
    instantEvals: {
      classifier,
      maxConcurrency,
      // A page is already bounded by its own size, so the budget is only a
      // backstop against a page of texts far larger than the classifier
      // takes: whatever the whole page could carry at the state cap.
      queryTokenBudget:
        Math.max(1, traceIds.length) * classifier.limits.stateTokens,
    },
    ...(signal ? { signal } : {}),
  });
  return {
    columns: hydration.columns,
    rows: hydration.rows,
    usage: hydration.evalUsage ?? {
      requests: 0,
      inputTokens: 0,
      skipped: {},
    },
  };
}

/** The same page's rows with their text extracted and nothing judged. */
async function textPass(
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
    maxRows: traceIds.length,
  });
  const hydration = await passes.hydrate({
    caller,
    protections,
    calls: instantEvalTextPlan(calls),
    execution,
  });
  return hydration.rows;
}
