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

import type { LangWatchQLAppFunctionCall } from "~/server/analytics/lwql";
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
  InstantEvalRowSource,
} from "./row-source";

const logger = createLogger("langwatch:instant-evals:run-executor");

/**
 * Rows one page judges when the texts are ordinary.
 *
 * Five hundred, which is half the thousand-key cap the hydration stage
 * enforces, so a statement whose extraction reads threads rather than traces
 * still fits its own lower cap on most pages.
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

/** The page size the sampled texts call for. */
export function instantEvalPageSizeFor(averageTextBytes: number): number {
  return averageTextBytes > INSTANT_EVAL_LARGE_TEXT_BYTES
    ? INSTANT_EVAL_SMALL_PAGE_SIZE
    : INSTANT_EVAL_PAGE_SIZE;
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

async function judgeRunPageOrThrow(
  deps: InstantEvalRunExecutorDependencies,
  prefetches: InstantEvalPrefetches,
  input: Parameters<InstantEvalRunPort["judgePage"]>[0],
): Promise<InstantEvalPageOutcome> {
  const {
    runId,
    projectId,
    page,
    afterTraceId,
    afterSpanId,
    pageSize,
    remaining,
  } = input;
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

  const limit = Math.max(1, Math.min(pageSize, remaining));
  const read = async (after: {
    afterTraceId: string | null;
    afterSpanId: string | null;
    limit: number;
  }): Promise<PrefetchedPage> => {
    const keyPage = await deps.rowSource.keys({
      caller,
      sql: row.sql,
      parameters,
      keyColumns: input.keyColumns,
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
    if (keyPage.keys.length === 0) return { keyPage, prepared: null };
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
    return { keyPage, prepared };
  };

  const current =
    (await prefetches.take({ runId, afterTraceId, afterSpanId, limit })) ??
    (await read({ afterTraceId, afterSpanId, limit }));
  const { keyPage, prepared } = current;
  if (keyPage.keys.length === 0 || prepared === null) return emptyPage();

  // The next page is read while this one judges. Its limit is what the next
  // intent will ask for when every key of this page becomes a judged row,
  // which is the common case; the intent that arrives asking for anything
  // else misses and reads for itself.
  const last = keyPage.keys.at(-1);
  const nextRemaining = remaining - keyPage.keys.length;
  if (keyPage.hasMore && nextRemaining > 0 && last) {
    const nextKey = {
      runId,
      afterTraceId: last.traceId,
      cursorSpanId: last.spanId ? last.spanId : null,
      limit: Math.max(1, Math.min(pageSize, nextRemaining)),
    };
    prefetches.start(
      {
        runId,
        afterTraceId: nextKey.afterTraceId,
        afterSpanId: nextKey.cursorSpanId,
        limit: nextKey.limit,
      },
      () =>
        read({
          afterTraceId: nextKey.afterTraceId,
          afterSpanId: nextKey.cursorSpanId,
          limit: nextKey.limit,
        }),
    );
  }

  const judged = await judgeUnderCancellation({
    deps,
    projectId,
    runId,
    prepared,
  });

  const at = deps.now?.() ?? Date.now();
  const mapping = mapInstantEvalPage({
    tenantId: projectId,
    runId,
    questions,
    rows: judged.rows,
    keys: keyPage.keys,
    skipReason: instantEvalSkipReason(judged.usage.skipped),
    now: at,
  });

  // A page that mostly failed is thrown so the outbox delivers it again,
  // rather than baking a bad minute of the provider's day into the answer.
  // Thrown BEFORE the write, so the retry is the only thing that records it.
  const failureRate = instantEvalPageFailureRate({
    counters: mapping.counters,
    questions: questions.length,
  });
  if (failureRate > INSTANT_EVAL_PAGE_FAILURE_CEILING) {
    throw new Error(
      `instant eval page ${page} of run ${runId} lost ${Math.round(failureRate * 100)}% of its judgements`,
    );
  }

  // Written before the page is recorded, so a crash between the two costs
  // a redelivery rather than a lost page.
  await deps.judgments.insert(mapping.records);

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
