/**
 * Judging one page of a run: what it reads, what it judges, and where it says
 * the next page starts.
 *
 * The step the pipeline drives most often, and the only one that spends money.
 * It takes the page the read-ahead prepared, judges it under whatever can stop
 * it part way, writes what came back, and reports the cursor the next intent
 * resumes from.
 *
 * @see ./instant-eval-run.prefetch.ts: where the page was read
 * @see ./instant-eval-run.page-record.ts: where its rows and profile are written
 * @see ./cancellation-watch.ts: how a page already judging is stopped
 */

import { createLogger } from "@langwatch/observability";

import type {
  InstantEvalPageOutcome,
  InstantEvalRunPort,
} from "~/server/event-sourcing/pipelines/instant-eval-processing/process-manager";
import { instantEvalCostUsd, instantEvalPriceUsd } from "../classifier/pricing";
import { watchForCancellation } from "./cancellation-watch";
import {
  type InstantEvalRunExecutorDependencies,
  loadRun,
} from "./instant-eval-run.executor";
import {
  recordPageProfile,
  writeJudgedPage,
} from "./instant-eval-run.page-record";
import {
  type InstantEvalPrefetches,
  takePageAndReadAhead,
} from "./instant-eval-run.prefetch";
import type { InstantEvalPageCounters } from "./judgments";
import {
  cutPageAtStop,
  type InstantEvalPageStop,
  pageDeadlineMs,
  pageStopReason,
} from "./page-stop";
import type {
  InstantEvalJudgedPage,
  InstantEvalPreparedPage,
  InstantEvalRowKey,
} from "./row-source";

const logger = createLogger("langwatch:instant-evals:run-judge-page");

/** One page: its keys, its verdicts, and what it added to the run. */
export async function judgeRunPage(
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
  const { runId, projectId, page } = input;
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

  // Thrown rather than returning an empty page: a run stopped by the budget
  // did not finish its selection, and recording it as complete would report a
  // partial answer as the whole one.
  await deps.assertWithinBudget?.({
    projectId,
    runId,
    inFlightUsd: runSpendSoFarUsd(deps, row.tokens),
  });

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

  const { judged, stop } = await judgeUnderCancellation({
    deps,
    projectId,
    runId,
    page,
    prepared,
    deadlineAt: input.deadlineAt,
  });
  const cut = cutPageAtStop({ judged, keys: keyPage.keys });

  const { mapping, insertMs } = await writeJudgedPage({
    deps,
    projectId,
    runId,
    page,
    questions,
    judged: { ...judged, rows: cut.rows },
    keys: keyPage.keys,
    ...unjudgedRowsFor({ stop, cut }),
  });
  if (stop) {
    logger.info(
      { projectId, runId, page, stop, rows: cut.rows.length },
      "Instant Eval page stopped part way; what was judged is written",
    );
  }

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

  return pageOutcomeFor({
    input,
    cut,
    keyPage,
    counters: mapping.counters,
    judged,
    stop,
  });
}

/** The rows a stop left unjudged, named with its reason, for the page write. */
function unjudgedRowsFor({
  stop,
  cut,
}: {
  stop: InstantEvalPageStop | null;
  cut: ReturnType<typeof cutPageAtStop>;
}): Pick<Parameters<typeof writeJudgedPage>[0], "unjudgedRows"> {
  if (!stop || cut.unjudgedIndexes.size === 0) return {};
  return {
    unjudgedRows: {
      indexes: cut.unjudgedIndexes,
      reason: pageStopReason(stop),
    },
  };
}

/**
 * Where the next page starts and whether there is one.
 *
 * A page cut short by its deadline ends where its judging did, and a page
 * that judged nothing before the deadline stays where it started, so the
 * next intent asks for the same rows again rather than for the run's first.
 * A cancelled run has no next page whatever is left: the process is finishing
 * it, and the intent for the next page would never be sent.
 */
function pageOutcomeFor({
  input,
  cut,
  keyPage,
  counters,
  judged,
  stop,
}: {
  input: Parameters<InstantEvalRunPort["judgePage"]>[0];
  cut: ReturnType<typeof cutPageAtStop>;
  keyPage: { keys: readonly InstantEvalRowKey[]; hasMore: boolean };
  counters: InstantEvalPageCounters;
  judged: InstantEvalJudgedPage;
  stop: InstantEvalPageStop | null;
}): InstantEvalPageOutcome {
  const last = keyPage.keys.at(-1);
  const resumeFrom = cut.last ?? (cut.isCutShort ? null : last);
  const cursor =
    resumeFrom === null
      ? { traceId: input.afterTraceId, spanId: input.afterSpanId }
      : {
          traceId: resumeFrom?.traceId ?? null,
          spanId: resumeFrom?.spanId || null,
        };
  const hasRowsLeft =
    (cut.isCutShort || keyPage.hasMore) && input.remaining - counters.rows > 0;
  return {
    ...counters,
    inputTokens: judged.usage.inputTokens,
    requests: judged.usage.requests,
    cursor: cursor.traceId,
    // Empty when the statement has one row per trace, which is what tells the
    // next key pass to compare the trace alone.
    cursorSpanId: cursor.spanId,
    hasNextPage: stop === "cancelled" ? false : hasRowsLeft,
  };
}

/**
 * One prepared page, judged, with a cancel or the lease able to stop it part
 * way.
 *
 * A cancel asked for mid-page stops the page rather than the run's next one.
 * The lease is the other stop: a page still judging when its outbox lease
 * lapses is one another dispatcher may start again, so the page gives itself
 * a deadline inside the lease. Either signal makes the hydration stage stop
 * scheduling classifications and hand back the ones that answered, which are
 * written and paid for; the rest are not.
 *
 * A lease with no room left is a page that is not started at all: the throw
 * is retried by the outbox under a fresh lease, which is cheaper than judging
 * a page that could not be recorded in time.
 */
async function judgeUnderCancellation({
  deps,
  projectId,
  runId,
  page,
  prepared,
  deadlineAt,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  runId: string;
  page: number;
  prepared: InstantEvalPreparedPage;
  deadlineAt: number | null;
}): Promise<{
  judged: InstantEvalJudgedPage;
  stop: InstantEvalPageStop | null;
}> {
  const deadlineMs = pageDeadlineMs({
    deadlineAt,
    now: deps.now?.() ?? Date.now(),
  });
  if (deadlineMs !== null && deadlineMs <= 0) {
    throw new Error(
      `instant eval page ${page} of run ${runId} has no lease left to judge under; retrying under a fresh one`,
    );
  }
  const deadline = deadlineMs === null ? null : AbortSignal.timeout(deadlineMs);
  const cancelWatch = watchForCancellation({
    ...(deps.isCancelled ? { isCancelled: deps.isCancelled } : {}),
    projectId,
    runId,
  });
  const signal = anySignal([cancelWatch?.signal, deadline]);
  try {
    const judged = await deps.rowSource.judgePrepared({
      page: prepared,
      ...(signal ? { signal } : {}),
    });
    return {
      judged,
      stop: stopReasonFor({ cancelWatch, deadline, judged }),
    };
  } finally {
    cancelWatch?.stop();
  }
}

/** One signal over the ones that exist, or none when there are none. */
function anySignal(
  candidates: readonly (AbortSignal | null | undefined)[],
): AbortSignal | null {
  const signals = candidates.filter(
    (candidate): candidate is AbortSignal =>
      candidate !== null && candidate !== undefined,
  );
  return signals.length > 0 ? AbortSignal.any(signals) : null;
}

/**
 * Which stop reached the page, if any. A page that reports a cancellation
 * nobody here asked for was stopped by the signal its own caller handed down,
 * which is a cancel.
 */
function stopReasonFor({
  cancelWatch,
  deadline,
  judged,
}: {
  cancelWatch: { signal: AbortSignal } | null;
  deadline: AbortSignal | null;
  judged: InstantEvalJudgedPage;
}): InstantEvalPageStop | null {
  if (cancelWatch?.signal.aborted) return "cancelled";
  if (deadline?.aborted) return "deadline";
  return judged.cancellation ? "cancelled" : null;
}

/**
 * What this run has already spent, priced the way its finish will price it.
 *
 * Read off the run row's running token total rather than tracked here, because
 * a page is its own intent: the process that judges page six need not be the
 * one that judged page five, and the row is what both of them share.
 */
function runSpendSoFarUsd(
  deps: InstantEvalRunExecutorDependencies,
  inputTokens: number,
): number {
  if (inputTokens <= 0) return 0;
  const pricing = deps.classifier().pricing;
  return instantEvalPriceUsd({
    costUsd: instantEvalCostUsd({ inputTokens, pricing }),
    pricing,
  });
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
