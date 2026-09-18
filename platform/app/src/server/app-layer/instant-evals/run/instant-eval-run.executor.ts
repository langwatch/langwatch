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
import type { InstantEvalRowKey, InstantEvalRowSource } from "./row-source";

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
  return {
    plan: (input) => planRun(deps, input),
    judgePage: (input) => judgeRunPage(deps, input),
    finish: (input) => finishRun(deps, input),
  };
}

/** One page: its keys, its verdicts, and what it added to the run. */
async function judgeRunPage(
  deps: InstantEvalRunExecutorDependencies,
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
    return emptyPage();
  }

  const startedKeys = Date.now();
  const keyPage = await deps.rowSource.keys({
    caller,
    sql: row.sql,
    parameters,
    keyColumns: input.keyColumns,
    limit: Math.max(1, Math.min(pageSize, remaining)),
    ...(afterTraceId === null
      ? {}
      : { after: { traceId: afterTraceId, spanId: afterSpanId } }),
  });
  const keyMs = Date.now() - startedKeys;
  if (keyPage.keys.length === 0) return emptyPage();

  const judged = await judgeUnderCancellation({
    deps,
    projectId,
    runId,
    caller,
    row,
    parameters,
    keys: keyPage.keys,
  });

  const { mapping, insertMs } = await writePageJudgements({
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
    startedKeys,
    keyMs,
    insertMs,
    judged,
  });

  const last = keyPage.keys.at(-1);
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
 * One page's verdicts, mapped to judgement rows and written.
 *
 * A page that mostly failed throws instead, so the outbox delivers it again
 * rather than baking a bad minute of the provider's day into the answer. Thrown
 * BEFORE the write, so the retry is the only thing that records it.
 *
 * The write itself happens before the page is recorded as judged, so a crash
 * between the two costs a redelivery rather than a lost page, and the
 * redelivery re-inserts the same keyed rows rather than doubling them.
 */
async function writePageJudgements({
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
  questions: ReturnType<typeof readInstantEvalRunQuestions>;
  judged: Awaited<ReturnType<InstantEvalRowSource["judge"]>>;
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
 * What one page spent its wall clock on, at debug level.
 *
 * A run is a loop of pages, so a run several times slower than its judging
 * should be is explained by one of these numbers rather than by the total.
 * `gapMs` is the part no step here owns: the time between the previous page of
 * this run finishing and this one starting, which is what the pipeline spent
 * delivering the page event and scheduling the next intent.
 */
function recordPageProfile({
  projectId,
  runId,
  page,
  rows,
  startedKeys,
  keyMs,
  insertMs,
  judged,
}: {
  projectId: string;
  runId: string;
  page: number;
  rows: number;
  startedKeys: number;
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
      gapMs: previous === undefined ? null : startedKeys - previous,
      keyMs,
      queryMs: judged.timings.queryMs,
      readMs: judged.timings.readMs,
      computeMs: judged.timings.computeMs,
      judgeMs: judged.timings.judgeMs,
      limiterWaitMs: judged.usage.limiterWaitMs,
      insertMs,
      pageMs: finishedAt - startedKeys,
    },
    "Instant Eval page profile",
  );
  lastPageFinishedAt.set(runId, finishedAt);
}

/**
 * One page, judged, with a cancel able to stop it part way.
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
  caller,
  row,
  parameters,
  keys,
}: {
  deps: InstantEvalRunExecutorDependencies;
  projectId: string;
  runId: string;
  caller: { id: string; lwqlKey: string };
  row: { sql: string; plan: unknown };
  parameters: Record<string, unknown>;
  keys: readonly InstantEvalRowKey[];
}): Promise<Awaited<ReturnType<InstantEvalRowSource["judge"]>>> {
  const cancelWatch = watchForCancellation({
    ...(deps.isCancelled ? { isCancelled: deps.isCancelled } : {}),
    projectId,
    runId,
  });
  try {
    return await deps.rowSource.judge({
      caller,
      protections: await deps.protections(projectId),
      sql: row.sql,
      parameters,
      calls: instantEvalHydrationPlan(row.plan),
      keys,
      classifier: deps.classifier(),
      maxConcurrency: deps.maxConcurrency,
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
