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
  judgeLangWatchQLHydration,
  type LangWatchQLAppFunctionCall,
  type LangWatchQLAppFunctionTraceSource,
  type LangWatchQLColumn,
  type LangWatchQLEvalUsage,
  type LangWatchQLExecutor,
  type LangWatchQLPreparedHydration,
  lwqlAppFunction,
  lwqlConnectionFromEnv,
  lwqlTenantCapability,
  prepareLangWatchQLHydration,
} from "~/server/analytics/lwql";
import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import { INSTANT_EVAL_OPTIONAL_KEY_COLUMNS } from "./composition";
import {
  countPass,
  type InstantEvalPassExecution,
  type InstantEvalPasses,
  judgePass,
  judgePreparedPass,
  keyPass,
  probePass,
  readPass,
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
  /**
   * Present when the signal stopped the judging part way: which rows never
   * got their answer. Absent for a page judged to the end.
   */
  readonly cancellation?: { readonly unjudgedRows: readonly number[] };
}

/**
 * One page read and extracted, with nothing judged yet.
 *
 * What {@link InstantEvalRowSource.read} answers and
 * {@link InstantEvalRowSource.judgePrepared} takes. Opaque to the run on
 * purpose: it holds the traces and the rendered texts of up to a page of rows,
 * and the run only ever hands it back.
 */
export interface InstantEvalPreparedPage {
  /** Rows the page owns, which is what will be judged. */
  readonly rows: number;
  /** How long the page statement took, for the judged page's timings. */
  readonly queryMs: number;
  readonly hydration: LangWatchQLPreparedHydration;
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

  /**
   * One page of rows, read and extracted but not judged.
   *
   * The half of {@link judge} that costs nothing, separated so a run can read
   * its next page while the classifier is busy with this one.
   */
  read(input: {
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
  }): Promise<InstantEvalPreparedPage>;

  /** The other half: judges a page {@link read} prepared. */
  judgePrepared(input: {
    page: InstantEvalPreparedPage;
    signal?: AbortSignal;
  }): Promise<InstantEvalJudgedPage>;

  /** One page of rows, judged: {@link read} then {@link judgePrepared}. */
  judge(input: {
    caller: InstantEvalRunCaller;
    protections: Protections;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    calls: readonly LangWatchQLAppFunctionCall[];
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
  const executorOrRefuse = (): LangWatchQLExecutor => {
    if (!dependencies.executor)
      throw new InstantEvalRowSourceUnavailableError();
    return dependencies.executor;
  };

  return instantEvalRowSourceOver({
    run: boundedRunOver({ executorOrRefuse }),
    prepare: hydrationPrepareOver({
      traceSource: sharedTraceSource(dependencies),
    }),
    judge: hydrationJudge,
  });
}

/**
 * The trace source these passes hydrate through, built once per row source.
 *
 * Built lazily because a row source is constructed while the application
 * container is: a deployment that never runs a job must not open the store on
 * the way past.
 */
function sharedTraceSource(
  dependencies: InstantEvalRowSourceDependencies,
): () => LangWatchQLAppFunctionTraceSource {
  let cached: LangWatchQLAppFunctionTraceSource | undefined;
  return () =>
    (cached ??=
      dependencies.traceSource ?? createLangWatchQLAppFunctionTraceSource());
}

/** Runs one pass's statement as the caller, bounded by what the pass asked for. */
function boundedRunOver({
  executorOrRefuse,
}: {
  executorOrRefuse: () => LangWatchQLExecutor;
}): InstantEvalPasses["run"] {
  return async ({ caller, sql, parameters, maxRows }) =>
    await runBounded({
      execute: () =>
        executorOrRefuse().execute({
          sql,
          ...(parameters && Object.keys(parameters).length > 0
            ? { parameters }
            : {}),
          tenantCapability: lwqlTenantCapability({ secret: caller.lwqlKey }),
          usesAppFunctions: true,
        }),
      maxRows,
    });
}

/** The read half of hydration: the traces a pass's rows name, extracted. */
function hydrationPrepareOver({
  traceSource,
}: {
  traceSource: () => LangWatchQLAppFunctionTraceSource;
}): InstantEvalPasses["prepare"] {
  return async ({ caller, protections, calls, execution, instantEvals }) =>
    await prepareLangWatchQLHydration({
      // A run belongs to one project, which is the scope every judgement in it
      // is rated and billed against.
      projectIds: [caller.id],
      protections,
      calls,
      columns: execution.columns,
      rows: execution.rows,
      limits: DEFAULT_LWQL_RESULT_LIMITS,
      traceSource: traceSource(),
      ...(instantEvals ? { instantEvals } : {}),
    });
}

/** The judge half: what a prepared hydration answers, stoppable by a signal. */
const hydrationJudge: InstantEvalPasses["judge"] = async ({
  prepared,
  signal,
}) =>
  await judgeLangWatchQLHydration({
    prepared,
    ...(signal ? { signal } : {}),
  });

/** The row source's eight reads, each one pass composed over the three above. */
function instantEvalRowSourceOver(
  passes: InstantEvalPasses,
): InstantEvalRowSource {
  return {
    probe: (input) => probePass(passes, input),
    count: (input) => countPass(passes, input),
    keys: (input) => keyPass(passes, input),
    sampleKeys: (input) => sampleKeysPass(passes, input),
    read: (input) => readPass(passes, input),
    judgePrepared: (input) => judgePreparedPass(passes, input),
    judge: (input) => judgePass(passes, input),
    texts: (input) => textPass(passes, input),
  };
}

/**
 * Runs one pass's statement and says whether the result outgrew its bound.
 *
 * The executor hands back every row the database returned — bounding a result
 * is the caller's business, and for a run it is per pass: the probe, the count
 * and the key pass bound themselves in SQL, while the page pass is bounded by
 * how far its traces expand. A row count above the bound is what the passes
 * refuse on, because a page read as whole when it was cut is the one failure a
 * run cannot notice later.
 */
async function runBounded({
  execute,
  maxRows,
}: {
  execute: () => Promise<Awaited<ReturnType<LangWatchQLExecutor["execute"]>>>;
  maxRows: number;
}): Promise<InstantEvalPassExecution> {
  const execution = await execute();
  return { ...execution, isTruncated: execution.rows.length > maxRows };
}
