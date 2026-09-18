/**
 * The run's three steps, as the pipeline's port over them.
 *
 * This is where the pieces meet: the run's own row says what to run, the row
 * source runs it, the judgements go to ClickHouse, and what it spent is
 * recorded once at the end. The pipeline sees none of that, it holds the topology and
 * calls three methods.
 *
 * ## Why the judgements are written here and not by a projection
 *
 * One judged page becomes up to fifteen hundred rows, and a map projection is
 * one record per event by contract. The alternative would be an event carrying
 * every verdict, which is the thing the design is built to avoid: the page
 * events stay in the hundreds of bytes so a hundred thousand rows is a couple
 * of hundred events rather than three hundred thousand.
 *
 * What replaces the projection's guarantee is the key: a judgement is keyed by
 * `(TenantId, RunId, TraceId, SpanId, QuestionId)` in a replacing table, and
 * the write happens BEFORE the page is recorded as judged. So a crash between
 * the two costs a redelivery, and the redelivery re-inserts the same rows
 * rather than doubling them.
 *
 * ## Why the next page is read while this one judges
 *
 * A page is a read (the statement, the traces, the texts) and then a judging,
 * and the two are bound by different services. Run one after the other, the
 * read sits on the critical path of every page; run the next page's read
 * while this page judges and it does not. One page still judges at a time,
 * because the judge is what saturates and the tenant's share of it bounds a
 * run anyway. See {@link InstantEvalPrefetches}.
 *
 * @see ./row-source.ts
 * @see ./cancellation-watch.ts: how a page already judging is stopped
 * @see ./instant-eval-run.plan.ts: the planning step
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/process-manager/instantEvalIntentHandlers.ts
 */

import { createLogger } from "@langwatch/observability";

import {
  type LangWatchQLAppFunctionCall,
  lwqlAppFunction,
  lwqlAppFunctionCap,
} from "~/server/analytics/lwql";
import type {
  InstantEvalPageOutcome,
  InstantEvalRunPort,
  InstantEvalSpend,
} from "~/server/event-sourcing/pipelines/instant-eval-processing/process-manager";
import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import { instantEvalCostUsd, instantEvalPriceUsd } from "../classifier/pricing";
import type { InstantEvalSpendRecorder } from "../instant-eval-spend.recorder";
import { watchForCancellation } from "./cancellation-watch";
import { InstantEvalRunNotFoundError } from "./errors";
import type { InstantEvalJudgmentsRepository } from "./instant-eval-judgments.repository";
import { planRun } from "./instant-eval-run.plan";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository";
import {
  INSTANT_EVAL_PAGE_FAILURE_CEILING,
  instantEvalPageFailureRate,
  instantEvalSkipReason,
  mapInstantEvalPage,
} from "./judgments";
import { readInstantEvalRunQuestions } from "./questions";
import type {
  InstantEvalJudgedPage,
  InstantEvalKeyPage,
  InstantEvalPreparedPage,
  InstantEvalRowKey,
  InstantEvalRowSource,
} from "./row-source";

const logger = createLogger("langwatch:instant-evals:run-executor");

/**
 * When each run's previous page finished, so a page can report the gap before
 * it.
 *
 * Per pod and best-effort: a run whose pages are spread over several pods sees
 * a gap only for consecutive pages on the same one, which is enough for the
 * question it answers. Entries are dropped when the run finishes.
 */
const lastPageFinishedAt = new Map<string, number>();

/**
 * Rows one page judges when the texts are ordinary.
 *
 * Five hundred, which is half the thousand-key cap the hydration stage
 * enforces for a trace or a span. A statement whose extraction reads another
 * kind of key has a lower cap of its own, and
 * {@link instantEvalPageSizeFor} lowers the page to it: `threads` caps at two
 * hundred keys, so a five hundred row page over conversations fails the whole
 * run with `lwql_app_function_key_cap` rather than judging anything.
 */
export const INSTANT_EVAL_PAGE_SIZE = 500;

/** Rows one page judges when the texts are large. */
export const INSTANT_EVAL_SMALL_PAGE_SIZE = 100;

/**
 * Average text size past which a page is cut to a fifth.
 *
 * Twelve kilobytes is about three thousand tokens, at which five hundred texts
 * is a page holding six megabytes of conversation in memory at once while
 * thirty-two of them are in flight. The smaller page is not about the
 * classifier, which takes them one at a time either way; it is about what one
 * worker holds.
 */
export const INSTANT_EVAL_LARGE_TEXT_BYTES = 12 * 1024;

export interface InstantEvalRunExecutorDependencies {
  readonly runs: InstantEvalRunRepository;
  readonly judgments: InstantEvalJudgmentsRepository;
  readonly rowSource: InstantEvalRowSource;
  readonly classifier: () => InstantEvalClassifier;
  readonly spendRecorder: InstantEvalSpendRecorder;
  /** Where the run reads the project's own query capability from. */
  readonly projectKey: (projectId: string) => Promise<string | null>;
  /** Classifications one page keeps in flight. */
  readonly maxConcurrency: number;
  /** Where the run reads the caller's content permissions from. */
  readonly protections: (projectId: string) => Promise<Protections>;
  /** Whether this run has been asked to stop, checked between pages. */
  readonly isCancelled?: (input: {
    projectId: string;
    runId: string;
  }) => Promise<boolean>;
  readonly now?: () => number;
}

/** Everything a step needs about the run it is a step of. */
export async function loadRun({
  deps,
  projectId,
  runId,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  runId: string;
}) {
  const row = await deps.runs.findById({ projectId, runId });
  if (!row) throw new InstantEvalRunNotFoundError({ runId });
  const lwqlKey = await deps.projectKey(projectId);
  if (!lwqlKey) throw new InstantEvalRunNotFoundError({ runId });
  return {
    row,
    caller: { id: projectId, lwqlKey },
    questions: readInstantEvalRunQuestions(row.questions),
    parameters: (row.parameters ?? {}) as Record<string, unknown>,
  };
}

/**
 * The keys one execution of this statement may hydrate, the lowest cap wins.
 *
 * Every app function the statement calls carries a cap by the kind of key it
 * reads, and one execution has to satisfy all of them at once. A statement
 * over conversations is the case that matters: its cap is two hundred, far
 * below the five hundred a page would otherwise hold.
 */
export function instantEvalKeyCapFor(
  calls: readonly LangWatchQLAppFunctionCall[],
): number {
  const caps = calls.flatMap((call) => {
    const names = [call.function, call.source?.function].filter(
      (name): name is string => typeof name === "string",
    );
    return names.flatMap((name) => {
      const definition = lwqlAppFunction(name);
      return definition ? [lwqlAppFunctionCap(definition)] : [];
    });
  });
  return caps.length === 0 ? INSTANT_EVAL_PAGE_SIZE : Math.min(...caps);
}

/**
 * The page size the sampled texts and the statement's key caps call for.
 *
 * The text size chooses a page, and the key cap bounds it: a page over the cap
 * is refused by the hydration stage, which fails the run rather than returning
 * fewer rows, so the cap has to be respected here and not discovered there.
 */
export function instantEvalPageSizeFor(
  averageTextBytes: number,
  keyCap: number = INSTANT_EVAL_PAGE_SIZE,
): number {
  const byText =
    averageTextBytes > INSTANT_EVAL_LARGE_TEXT_BYTES
      ? INSTANT_EVAL_SMALL_PAGE_SIZE
      : INSTANT_EVAL_PAGE_SIZE;
  return Math.max(1, Math.min(byText, keyCap));
}

/** The mean byte length of the judged texts in a sample of rows. */
export function instantEvalAverageTextBytes({
  rows,
  questionIds,
}: {
  rows: readonly Record<string, unknown>[];
  questionIds: readonly string[];
}): number {
  let bytes = 0;
  let texts = 0;
  for (const row of rows) {
    for (const id of questionIds) {
      const value = row[id];
      if (typeof value !== "string") continue;
      bytes += Buffer.byteLength(value, "utf8");
      texts += 1;
    }
  }
  return texts === 0 ? 0 : Math.round(bytes / texts);
}

export function createInstantEvalRunExecutor(
  deps: InstantEvalRunExecutorDependencies,
): InstantEvalRunPort {
  const prefetches = new InstantEvalPrefetches();
  return {
    plan: (input) => planRun(deps, input),
    judgePage: (input) => judgeRunPage(deps, prefetches, input),
    finish: (input) => {
      prefetches.discard(input.runId);
      return finishRun(deps, input);
    },
  };
}

/** What the next page needs to have been read with, to be the same page. */
interface PrefetchKey {
  readonly runId: string;
  readonly afterTraceId: string | null;
  readonly afterSpanId: string | null;
  readonly limit: number;
}

/** One page's keys and its read, started before the run asked for it. */
interface PrefetchedPage {
  readonly keyPage: InstantEvalKeyPage;
  readonly prepared: InstantEvalPreparedPage | null;
  /** How long the key pass took, for the page profile. */
  readonly keyMs: number;
}

/**
 * The next page of each run, read while the current one is judged.
 *
 * The judge is the bottleneck of a run and it is a different service from the
 * database and the trace store, so a page's reads only lengthen the run when
 * they sit on the critical path. The page after the one being judged is
 * therefore started here, keyed by the cursor the next intent will arrive
 * with, and handed over when it does. One page judges at a time, exactly as
 * before: only the reading overlaps.
 *
 * Per executor and per pod, and best-effort throughout: an intent that lands
 * on another pod misses and reads the page itself, a run that stops or fails
 * drops what it had read, and a prefetch that fails is discarded rather than
 * surfaced, because the page it read will be read again by the intent that
 * needs it. Nothing here is recorded anywhere, so nothing here changes what a
 * redelivery does.
 */
class InstantEvalPrefetches {
  private readonly byRun = new Map<
    string,
    { key: PrefetchKey; page: Promise<PrefetchedPage> }
  >();

  start(key: PrefetchKey, read: () => Promise<PrefetchedPage>): void {
    const page = read();
    // A prefetch nobody consumes must not surface as an unhandled rejection;
    // its failure is observed, if at all, by the intent that takes it.
    page.catch(() => undefined);
    this.byRun.set(key.runId, { key, page });
  }

  /** The page read for this key, or null when none was, or it was another page. */
  async take(key: PrefetchKey): Promise<PrefetchedPage | null> {
    const entry = this.byRun.get(key.runId);
    if (!entry) return null;
    this.byRun.delete(key.runId);
    if (
      entry.key.afterTraceId !== key.afterTraceId ||
      entry.key.afterSpanId !== key.afterSpanId ||
      entry.key.limit !== key.limit
    ) {
      return null;
    }
    try {
      return await entry.page;
    } catch (error) {
      logger.warn(
        { runId: key.runId, error },
        "Instant Eval prefetched page failed; reading it again",
      );
      return null;
    }
  }

  discard(runId: string): void {
    this.byRun.delete(runId);
  }
}

/** One page: its keys, its verdicts, and what it added to the run. */
async function judgeRunPage(
  deps: InstantEvalRunExecutorDependencies,
  prefetches: InstantEvalPrefetches,
  input: Parameters<InstantEvalRunPort["judgePage"]>[0],
): Promise<InstantEvalPageOutcome> {
  try {
    return await judgeRunPageOrThrow(deps, prefetches, input);
  } catch (error) {
    // Whatever was read ahead belongs to a loop that just broke; the retry
    // starts from the recorded cursor and reads for itself.
    prefetches.discard(input.runId);
    throw error;
  }
}

/** Where a key pass resumes from, and how many keys it asks for. */
interface PageCursor {
  afterTraceId: string | null;
  afterSpanId: string | null;
  limit: number;
}

/**
 * One page's keys, and the rows behind them, read and extracted but unjudged.
 *
 * Its own function because both the page being judged now and the page being
 * read ahead go through it, and the read-ahead has to be the same read or the
 * page it hands over would not be the page the next intent asked for.
 */
async function readPage({
  deps,
  projectId,
  row,
  caller,
  parameters,
  keyColumns,
  after,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  row: Awaited<ReturnType<typeof loadRun>>["row"];
  caller: Awaited<ReturnType<typeof loadRun>>["caller"];
  parameters: Awaited<ReturnType<typeof loadRun>>["parameters"];
  keyColumns: Parameters<InstantEvalRunPort["judgePage"]>[0]["keyColumns"];
  after: PageCursor;
}): Promise<PrefetchedPage> {
  const startedKeys = Date.now();
  const keyPage = await deps.rowSource.keys({
    caller,
    sql: row.sql,
    parameters,
    keyColumns,
    limit: after.limit,
    ...(after.afterTraceId === null
      ? {}
      : {
          after: {
            traceId: after.afterTraceId,
            spanId: after.afterSpanId,
          },
        }),
  });
  const keyMs = Date.now() - startedKeys;
  if (keyPage.keys.length === 0) return { keyPage, prepared: null, keyMs };
  const prepared = await deps.rowSource.read({
    caller,
    protections: await deps.protections(projectId),
    sql: row.sql,
    parameters,
    calls: instantEvalHydrationPlan(row.plan),
    keys: keyPage.keys,
    classifier: deps.classifier(),
    maxConcurrency: deps.maxConcurrency,
  });
  return { keyPage, prepared, keyMs };
}

/**
 * Starts the next page's read while this one judges.
 *
 * Its limit is what the next intent will ask for when every key of this page
 * becomes a judged row, which is the common case; an intent that arrives
 * asking for anything else misses and reads for itself.
 */
function startNextPageRead({
  prefetches,
  runId,
  read,
  last,
  hasMore,
  remaining,
  pageSize,
}: {
  prefetches: InstantEvalPrefetches;
  runId: string;
  read: (after: PageCursor) => Promise<PrefetchedPage>;
  last: InstantEvalRowKey | undefined;
  hasMore: boolean;
  remaining: number;
  pageSize: number;
}): void {
  if (!hasMore || remaining <= 0 || !last) return;
  const after: PageCursor = {
    afterTraceId: last.traceId,
    afterSpanId: last.spanId ? last.spanId : null,
    limit: Math.max(1, Math.min(pageSize, remaining)),
  };
  prefetches.start({ runId, ...after }, () => read(after));
}

/**
 * Maps a judged page onto judgement rows and writes them.
 *
 * A page that mostly failed is thrown instead, so the outbox delivers it again
 * rather than baking a bad minute of the provider's day into the answer. The
 * throw comes BEFORE the write, so the retry is the only thing that records
 * it; the write comes before the page is recorded, so a crash between the two
 * costs a redelivery rather than a lost page.
 */
async function writeJudgedPage({
  deps,
  projectId,
  runId,
  page,
  questions,
  judged,
  keys,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  runId: string;
  page: number;
  questions: Awaited<ReturnType<typeof loadRun>>["questions"];
  judged: Awaited<ReturnType<typeof judgeUnderCancellation>>;
  keys: readonly InstantEvalRowKey[];
}): Promise<{
  mapping: ReturnType<typeof mapInstantEvalPage>;
  insertMs: number;
}> {
  const mapping = mapInstantEvalPage({
    tenantId: projectId,
    runId,
    questions,
    rows: judged.rows,
    keys,
    skipReason: instantEvalSkipReason(judged.usage.skipped),
    now: deps.now?.() ?? Date.now(),
  });

  const failureRate = instantEvalPageFailureRate({
    counters: mapping.counters,
    questions: questions.length,
  });
  if (failureRate > INSTANT_EVAL_PAGE_FAILURE_CEILING) {
    throw new Error(
      `instant eval page ${page} of run ${runId} lost ${Math.round(failureRate * 100)}% of its judgements`,
    );
  }

  const startedInsert = Date.now();
  await deps.judgments.insert(mapping.records);
  return { mapping, insertMs: Date.now() - startedInsert };
}

/**
 * The page this intent asked for, and the next one started behind it.
 *
 * The read-ahead is started here rather than after judging because the point
 * of it is to overlap the two: by the time this returns, the next page's key
 * pass and trace read are already under way against services the classifier
 * does not contend with. `prefetched` says whether this page came off that
 * read, which is what tells the profile its key and query time was paid before
 * the intent arrived.
 */
async function takePageAndReadAhead({
  deps,
  prefetches,
  input,
  row,
  caller,
  parameters,
}: {
  deps: InstantEvalRunExecutorDependencies;
  prefetches: InstantEvalPrefetches;
  input: Parameters<InstantEvalRunPort["judgePage"]>[0];
  row: Awaited<ReturnType<typeof loadRun>>["row"];
  caller: Awaited<ReturnType<typeof loadRun>>["caller"];
  parameters: Awaited<ReturnType<typeof loadRun>>["parameters"];
}): Promise<PrefetchedPage & { prefetched: boolean }> {
  const { runId, projectId, afterTraceId, afterSpanId, pageSize, remaining } =
    input;
  const limit = Math.max(1, Math.min(pageSize, remaining));
  const read = (after: PageCursor) =>
    readPage({
      deps,
      projectId,
      row,
      caller,
      parameters,
      keyColumns: input.keyColumns,
      after,
    });

  const taken = await prefetches.take({
    runId,
    afterTraceId,
    afterSpanId,
    limit,
  });
  const current = taken ?? (await read({ afterTraceId, afterSpanId, limit }));
  startNextPageRead({
    prefetches,
    runId,
    read,
    last: current.keyPage.keys.at(-1),
    hasMore: current.keyPage.hasMore,
    remaining: remaining - current.keyPage.keys.length,
    pageSize,
  });
  return { ...current, prefetched: taken !== null };
}

async function judgeRunPageOrThrow(
  deps: InstantEvalRunExecutorDependencies,
  prefetches: InstantEvalPrefetches,
  input: Parameters<InstantEvalRunPort["judgePage"]>[0],
): Promise<InstantEvalPageOutcome> {
  const { runId, projectId, page, remaining } = input;
  const { row, caller, questions, parameters } = await loadRun({
    deps,
    projectId,
    runId,
  });

  // Checked before the page rather than during it: a page is seconds of
  // judging, and stopping between pages is what the cancel contract
  // promises. The signal below is what stops one already under way.
  if (await deps.isCancelled?.({ projectId, runId })) {
    prefetches.discard(runId);
    return emptyPage();
  }

  const startedPage = Date.now();
  const { keyPage, prepared, keyMs, prefetched } = await takePageAndReadAhead({
    deps,
    prefetches,
    input,
    row,
    caller,
    parameters,
  });
  if (keyPage.keys.length === 0 || prepared === null) return emptyPage();
  const last = keyPage.keys.at(-1);

  const judged = await judgeUnderCancellation({
    deps,
    projectId,
    runId,
    prepared,
  });

  const { mapping, insertMs } = await writeJudgedPage({
    deps,
    projectId,
    runId,
    page,
    questions,
    judged,
    keys: keyPage.keys,
  });

  recordPageProfile({
    projectId,
    runId,
    page,
    rows: mapping.counters.rows,
    startedPage,
    prefetched,
    keyMs,
    insertMs,
    judged,
  });

  return {
    ...mapping.counters,
    inputTokens: judged.usage.inputTokens,
    requests: judged.usage.requests,
    cursor: last?.traceId ?? null,
    // Empty when the statement has one row per trace, which is what tells the
    // next key pass to compare the trace alone.
    cursorSpanId: last?.spanId ? last.spanId : null,
    hasNextPage: keyPage.hasMore && remaining - mapping.counters.rows > 0,
  };
}

/**
 * What one page spent its wall clock on, at debug level.
 *
 * A run is a loop of pages, so a run several times slower than its judging
 * should be is explained by one of these numbers rather than by the total.
 * `gapMs` is the part no step here owns: the time between the previous page of
 * this run finishing and this one starting, which is what the pipeline spent
 * delivering the page event and scheduling the next intent. `keyMs` and
 * `queryMs` are off this page's clock when `prefetched` is true, because the
 * previous page paid for them while it was judging.
 */
function recordPageProfile({
  projectId,
  runId,
  page,
  rows,
  startedPage,
  prefetched,
  keyMs,
  insertMs,
  judged,
}: {
  projectId: string;
  runId: string;
  page: number;
  rows: number;
  startedPage: number;
  prefetched: boolean;
  keyMs: number;
  insertMs: number;
  judged: Awaited<ReturnType<InstantEvalRowSource["judge"]>>;
}): void {
  const finishedAt = Date.now();
  const previous = lastPageFinishedAt.get(runId);
  logger.debug(
    {
      projectId,
      runId,
      page,
      rows,
      inputTokens: judged.usage.inputTokens,
      gapMs: previous === undefined ? null : startedPage - previous,
      prefetched,
      keyMs,
      queryMs: judged.timings.queryMs,
      readMs: judged.timings.readMs,
      computeMs: judged.timings.computeMs,
      judgeMs: judged.timings.judgeMs,
      limiterWaitMs: judged.usage.limiterWaitMs,
      insertMs,
      pageMs: finishedAt - startedPage,
    },
    "Instant Eval page profile",
  );
  lastPageFinishedAt.set(runId, finishedAt);
}

/**
 * One prepared page, judged, with a cancel able to stop it part way.
 *
 * A cancel asked for mid-page stops the page rather than the run's next one.
 * The hydration stage takes the signal and abandons the classifications it has
 * not started, so the rows already judged are still written and paid for, and
 * the rest are not.
 */
async function judgeUnderCancellation({
  deps,
  projectId,
  runId,
  prepared,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  runId: string;
  prepared: InstantEvalPreparedPage;
}): Promise<InstantEvalJudgedPage> {
  const cancelWatch = watchForCancellation({
    ...(deps.isCancelled ? { isCancelled: deps.isCancelled } : {}),
    projectId,
    runId,
  });
  try {
    return await deps.rowSource.judgePrepared({
      page: prepared,
      ...(cancelWatch ? { signal: cancelWatch.signal } : {}),
    });
  } finally {
    cancelWatch?.stop();
  }
}

/** What the run cost, recorded once. */
async function finishRun(
  deps: InstantEvalRunExecutorDependencies,
  {
    runId,
    projectId,
    outcome,
    inputTokens,
    requests,
  }: Parameters<InstantEvalRunPort["finish"]>[0],
): Promise<InstantEvalSpend> {
  const classifier = deps.classifier();
  const costUsd = instantEvalCostUsd({
    inputTokens,
    pricing: classifier.pricing,
  });
  const priceUsd = instantEvalPriceUsd({
    costUsd,
    pricing: classifier.pricing,
  });

  // A run that judged no row records no spend: a record of zero is one a
  // customer has to read and dismiss.
  //
  // A recorder that fails is rethrown rather than logged and forgotten. The
  // finish intent is the outbox's, so a throw here is retried, and the record
  // names the run so a recorder that keeps one can land the retry on the same
  // record instead of billing twice. Swallowing it would let the run record
  // itself finished with the spend filed nowhere and no way left to notice.
  if (inputTokens > 0) {
    await deps.spendRecorder.recordSpend({
      projectId,
      runId,
      inputTokens,
      requests,
      costUsd,
      priceUsd,
      occurredAt: new Date(deps.now?.() ?? Date.now()),
    });
    logger.debug(
      { projectId, runId, outcome, costUsd, priceUsd },
      "Instant Eval run spend recorded",
    );
  }

  lastPageFinishedAt.delete(runId);
  return { costUsd, priceUsd };
}

function emptyPage(): InstantEvalPageOutcome {
  return {
    rows: 0,
    matched: 0,
    matchedByQuestion: {},
    failed: 0,
    skipped: 0,
    inputTokens: 0,
    requests: 0,
    cursor: null,
    cursorSpanId: null,
    hasNextPage: false,
  };
}

/**
 * The hydration plan stored on the run.
 *
 * The validator's own record of what the statement's projection calls, stored
 * at creation and read back per page. Read defensively for the same reason the
 * questions are: a run outlives a catalog change, and a plan entry that no
 * longer names a function is one the hydration stage will skip rather than one
 * that should stop the run.
 */
export function instantEvalHydrationPlan(
  stored: unknown,
): readonly LangWatchQLAppFunctionCall[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap(readPlanEntry);
}

/** One stored plan entry, or nothing when it is not one. */
function readPlanEntry(entry: unknown): LangWatchQLAppFunctionCall[] {
  if (!entry || typeof entry !== "object") return [];
  const call = entry as Partial<LangWatchQLAppFunctionCall>;
  if (typeof call.column !== "string" || typeof call.function !== "string") {
    return [];
  }
  return [
    {
      column: call.column,
      function: call.function,
      options: Array.isArray(call.options) ? call.options : [],
      ...(call.source ? { source: call.source } : {}),
    },
  ];
}
