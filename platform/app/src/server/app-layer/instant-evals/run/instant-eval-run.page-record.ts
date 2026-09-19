/**
 * What a judged page leaves behind: its judgement rows, and its profile line.
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
 * @see ./instant-eval-run.judge-page.ts: the step that calls both of these
 * @see ./judgments.ts: how a judged page becomes judgement rows
 */

import { createLogger } from "@langwatch/observability";

import type {
  InstantEvalLoadedRun,
  InstantEvalRunExecutorDependencies,
} from "./instant-eval-run.executor";
import {
  INSTANT_EVAL_PAGE_FAILURE_CEILING,
  instantEvalPageFailureRate,
  instantEvalSkipReason,
  mapInstantEvalPage,
} from "./judgments";
import type { InstantEvalJudgedPage, InstantEvalRowKey } from "./row-source";

const logger = createLogger("langwatch:instant-evals:run-page-record");

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
 * Maps a judged page onto judgement rows and writes them.
 *
 * A page that mostly failed is thrown instead, so the outbox delivers it again
 * rather than baking a bad minute of the provider's day into the answer. The
 * throw comes BEFORE the write, so the retry is the only thing that records
 * it; the write comes before the page is recorded, so a crash between the two
 * costs a redelivery rather than a lost page.
 */
export async function writeJudgedPage({
  deps,
  projectId,
  runId,
  page,
  questions,
  judged,
  keys,
  unjudgedRows,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  runId: string;
  page: number;
  questions: InstantEvalLoadedRun["questions"];
  judged: InstantEvalJudgedPage;
  keys: readonly InstantEvalRowKey[];
  unjudgedRows?: Parameters<typeof mapInstantEvalPage>[0]["unjudgedRows"];
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
    ...(unjudgedRows ? { unjudgedRows } : {}),
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
export function recordPageProfile({
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
  judged: InstantEvalJudgedPage;
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

/** Drops what the profile remembered about a run, once the run is over. */
export function forgetPageProfile(runId: string): void {
  lastPageFinishedAt.delete(runId);
}
