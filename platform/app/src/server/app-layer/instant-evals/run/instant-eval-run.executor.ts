/**
 * The run's three steps, as the pipeline's port over them.
 *
 * This is where the pieces meet: the run's own row says what to run, the row
 * source runs it, the judgements go to ClickHouse, and what it cost is recorded
 * once at the end. The pipeline sees none of that, it holds the topology and
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
 * `(TenantId, RunId, TraceId, QuestionId)` in a replacing table, and the write
 * happens BEFORE the page is recorded as judged. So a crash between the two
 * costs a redelivery, and the redelivery re-inserts the same rows rather than
 * doubling them.
 *
 * @see ./row-source.ts
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/process-manager/instantEvalIntentHandlers.ts
 */

import { createLogger } from "@langwatch/observability";

import type { LangWatchQLAppFunctionCall } from "~/server/analytics/lwql";
import type {
  InstantEvalPageOutcome,
  InstantEvalPlan,
  InstantEvalRunPort,
  InstantEvalSpend,
} from "~/server/event-sourcing/pipelines/instant-eval-processing/process-manager";
import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import { instantEvalCostUsd, instantEvalPriceUsd } from "../classifier/pricing";
import type { InstantEvalCostRecorder } from "../instant-eval-cost.recorder";
import { InstantEvalRunNotFoundError } from "./errors";
import type { InstantEvalJudgmentsRepository } from "./instant-eval-judgments.repository";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository";
import {
  INSTANT_EVAL_PAGE_FAILURE_CEILING,
  instantEvalPageFailureRate,
  instantEvalSkipReason,
  mapInstantEvalPage,
} from "./judgments";
import { readInstantEvalRunQuestions } from "./questions";
import {
  type InstantEvalRowKey,
  type InstantEvalRowSource,
  instantEvalKeyColumns,
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

/** Rows a plan measures the text size of. */
const INSTANT_EVAL_SAMPLE_ROWS = 50;

export interface InstantEvalRunExecutorDependencies {
  readonly runs: InstantEvalRunRepository;
  readonly judgments: InstantEvalJudgmentsRepository;
  readonly rowSource: InstantEvalRowSource;
  readonly classifier: () => InstantEvalClassifier;
  readonly costRecorder: InstantEvalCostRecorder;
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
async function loadRun({
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
  return {
    plan: (input) => planRun(deps, input),
    judgePage: (input) => judgeRunPage(deps, input),
    finish: (input) => finishRun(deps, input),
  };
}

/** What the run is about to do, learned without judging anything. */
async function planRun(
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

  // One key pass over the whole selection, bounded by the run's own limit
  // plus one: the extra row is how a capped run learns it was capped
  // without a second count over the same statement.
  const keyPage = await deps.rowSource.keys({
    caller,
    sql: row.sql,
    parameters,
    keyColumns,
    limit: row.rowLimit,
  });

  // The first rows' texts, read without judging any of them, which is what
  // the page size is chosen from.
  const sampleIds = keyPage.keys
    .slice(0, INSTANT_EVAL_SAMPLE_ROWS)
    .map((key) => key.traceId);
  const sample =
    sampleIds.length === 0
      ? []
      : await deps.rowSource.texts({
          caller,
          protections: await deps.protections(projectId),
          sql: row.sql,
          parameters,
          calls: instantEvalHydrationPlan(row.plan),
          traceIds: sampleIds,
        });

  const averageTextBytes = instantEvalAverageTextBytes({
    rows: sample,
    questionIds: questions.map((question) => question.id),
  });

  return {
    total: keyPage.keys.length,
    pageSize: instantEvalPageSizeFor(averageTextBytes),
    isCapped: keyPage.hasMore,
    keyColumns,
  };
}

/** One page: its keys, its verdicts, and what it added to the run. */
async function judgeRunPage(
  deps: InstantEvalRunExecutorDependencies,
  input: Parameters<InstantEvalRunPort["judgePage"]>[0],
): Promise<InstantEvalPageOutcome> {
  const { runId, projectId, page, afterTraceId, pageSize, remaining } = input;
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

  const keyPage = await deps.rowSource.keys({
    caller,
    sql: row.sql,
    parameters,
    keyColumns: input.keyColumns,
    limit: Math.max(1, Math.min(pageSize, remaining)),
    ...(afterTraceId === null ? {} : { afterTraceId }),
  });
  if (keyPage.keys.length === 0) return emptyPage();

  const judged = await deps.rowSource.judge({
    caller,
    protections: await deps.protections(projectId),
    sql: row.sql,
    parameters,
    calls: instantEvalHydrationPlan(row.plan),
    traceIds: keyPage.keys.map((key) => key.traceId),
    classifier: deps.classifier(),
    maxConcurrency: deps.maxConcurrency,
  });

  const at = deps.now?.() ?? Date.now();
  const mapping = mapInstantEvalPage({
    tenantId: projectId,
    runId,
    questions,
    rows: judged.rows,
    keysByTraceId: keysByTraceId(keyPage.keys),
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

  const last = keyPage.keys.at(-1);
  return {
    ...mapping.counters,
    inputTokens: judged.usage.inputTokens,
    requests: judged.usage.requests,
    cursor: last?.traceId ?? null,
    hasNextPage: keyPage.hasMore && remaining - mapping.counters.rows > 0,
  };
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

  // A run that judged nothing writes no cost row: a row of zero is one a
  // customer has to read and dismiss.
  if (inputTokens > 0) {
    try {
      await deps.costRecorder.recordCost({
        projectId,
        inputTokens,
        requests,
        costUsd,
        priceUsd,
        runId,
      });
    } catch (error) {
      // The judgements were made and are already written. Losing the cost
      // row is an accounting problem to find in the logs, not a reason to
      // leave the run unfinished.
      logger.error(
        { projectId, runId, outcome, error },
        "Instant Eval run cost row could not be written",
      );
    }
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
    hasNextPage: false,
  };
}

function keysByTraceId(
  keys: readonly InstantEvalRowKey[],
): ReadonlyMap<string, InstantEvalRowKey> {
  return new Map(keys.map((key) => [key.traceId, key]));
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
