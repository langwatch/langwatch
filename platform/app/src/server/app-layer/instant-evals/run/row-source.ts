/**
 * Where a run's rows come from, and where its judgements are made.
 *
 * One interface over the LangWatchQL execution path, holding the four reads a
 * run performs and nothing else. It is an interface rather than a direct call
 * for the usual reason plus one that matters more here: a page of this is a
 * page of spend, so a suite has to be able to drive the whole loop against a
 * fake classifier and a fake executor without a datastore and without a bill.
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
import { INSTANT_EVAL_OPTIONAL_KEY_COLUMNS } from "./composition";
import {
  countPass,
  type InstantEvalPasses,
  judgePass,
  keyPass,
  probePass,
  sampleKeysPass,
  textPass,
} from "./row-source.passes";

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

/**
 * Where the next page starts.
 *
 * `spanId` is null for a statement whose rows are one per trace, and carries
 * the second half of the order for one whose rows are one per span.
 */
export interface InstantEvalCursor {
  readonly traceId: string;
  readonly spanId: string | null;
}

/** What one page of keys found, and whether more follow it. */
export interface InstantEvalKeyPage {
  readonly keys: readonly InstantEvalRowKey[];
  readonly hasMore: boolean;
}

/**
 * Raised when a read came back cut short by the executor's result ceiling.
 *
 * The ceiling is a byte budget applied after the rows arrive, and it truncates
 * rather than refusing, so a caller that ignores it reads a short answer as a
 * complete one. Every read here is a read whose length is the answer, so a
 * truncated one is an error and never a shorter page.
 */
export class InstantEvalResultTruncatedError extends Error {
  constructor(pass: string) {
    super(
      `the instant eval ${pass} pass came back truncated; narrow the statement or lower the page size`,
    );
    this.name = "InstantEvalResultTruncatedError";
  }
}

/** Where the wall clock of one judged page went. */
export interface InstantEvalPageTimings {
  /** Running the page statement against the database. */
  readonly queryMs: number;
  /** Reading the traces its keys name. */
  readonly readMs: number;
  /** Rendering those traces into the text to judge. */
  readonly computeMs: number;
  /** Judging that text, limiter wait included. */
  readonly judgeMs: number;
}

/** One page of judged rows, and what judging them spent. */
export interface InstantEvalJudgedPage {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly usage: LangWatchQLEvalUsage;
  /** Where the page's own wall clock went. */
  readonly timings: InstantEvalPageTimings;
}

export interface InstantEvalRowSource {
  /** What the statement projects, without reading a row or judging anything. */
  probe(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
  }): Promise<readonly LangWatchQLColumn[]>;

  /**
   * How many rows the statement matches, counted at most `limit`.
   *
   * Separate from {@link keys} because a run's total is needed before its
   * first page and reading a hundred thousand keys to learn it is both slow
   * and past the executor's result ceiling.
   */
  count(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    /** The run's row limit plus one, so a capped run knows it was capped. */
    limit: number;
  }): Promise<number>;

  /** One page of row keys, after the key the previous page ended on. */
  keys(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    /** Optional key columns the statement projects, from {@link probe}. */
    keyColumns: readonly string[];
    limit: number;
    after?: InstantEvalCursor;
  }): Promise<InstantEvalKeyPage>;

  /**
   * A sample of the selection's keys, spread across the whole of it.
   *
   * What the page size and the price are measured from. Separate from
   * {@link keys} because a page wants the *next* rows in order and a sample
   * wants rows from everywhere: the first fifty keys of a statement ordered by
   * conversation id are the fifty lowest ids, and measuring those prices the
   * wrong rows.
   */
  sampleKeys(input: {
    caller: InstantEvalRunCaller;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    keyColumns: readonly string[];
    limit: number;
    /** Rows the statement matches, which sets how wide the spread has to be. */
    total: number;
  }): Promise<readonly InstantEvalRowKey[]>;

  /** One page of rows, judged. */
  judge(input: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    /** The hydration plan the validator recorded for the inner statement. */
    calls: readonly LangWatchQLAppFunctionCall[];
    /** The page's own keys, which are also what its rows are matched against. */
    keys: readonly InstantEvalRowKey[];
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
    count: (input) => countPass(passes, input),
    keys: (input) => keyPass(passes, input),
    sampleKeys: (input) => sampleKeysPass(passes, input),
    judge: (input) => judgePass(passes, input),
    texts: (input) => textPass(passes, input),
  };
}
