/**
 * The run's three steps, as the pipeline's port over them.
 *
 * This is where the pieces meet: the run's own row says what to run, the row
 * source runs it, the judgements go to ClickHouse, and what it spent is
 * recorded once at the end. The pipeline sees none of that, it holds the
 * topology and calls three methods.
 *
 * Each step is a module of its own, and this one holds what all three share:
 * the dependencies they are given, the run they are a step of, and the
 * hydration plan stored on it.
 *
 * @see ./instant-eval-run.plan.ts: the planning step
 * @see ./instant-eval-run.judge-page.ts: the judging step
 * @see ./row-source.ts
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/process-manager/instantEvalIntentHandlers.ts
 */

import { createLogger } from "@langwatch/observability";

import type { LangWatchQLAppFunctionCall } from "~/server/analytics/lwql";
import type {
  InstantEvalRunPort,
  InstantEvalSpend,
} from "~/server/event-sourcing/pipelines/instant-eval-processing/process-manager";
import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import { instantEvalCostUsd, instantEvalPriceUsd } from "../classifier/pricing";
import type { InstantEvalSpendRecorder } from "../instant-eval-spend.recorder";
import { InstantEvalRunNotFoundError } from "./errors";
import type { InstantEvalJudgmentsRepository } from "./instant-eval-judgments.repository";
import { judgeRunPage } from "./instant-eval-run.judge-page";
import { forgetPageProfile } from "./instant-eval-run.page-record";
import { planRun } from "./instant-eval-run.plan";
import { InstantEvalPrefetches } from "./instant-eval-run.prefetch";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository";
import { readInstantEvalRunQuestions } from "./questions";
import type { InstantEvalRowSource } from "./row-source";

const logger = createLogger("langwatch:instant-evals:run-executor");

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
  /**
   * Refuses the next page once the organization's free allowance is gone.
   *
   * Checked per page rather than at admission alone: a run records its spend
   * once, when it finishes, so an admission check reads a ledger that knows
   * nothing about the run already under way. Passing what this run has judged
   * so far as `inFlightUsd` is what bounds it to one page past the budget.
   * Unset on a deployment with no free budget to enforce.
   */
  readonly assertWithinBudget?: (input: {
    projectId: string;
    runId: string;
    inFlightUsd: number;
  }) => Promise<void>;
  /**
   * Drops the hold the run was accepted under, once its spend is recorded.
   * Called on every outcome: a run that failed or was cancelled spends what
   * it judged and nothing more, and holding its estimate any longer would
   * refuse the runs after it for money that was never spent.
   */
  readonly releaseBudget?: (input: {
    projectId: string;
    runId: string;
  }) => Promise<void>;
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

/** The run a step is a step of, as {@link loadRun} answers it. */
export type InstantEvalLoadedRun = Awaited<ReturnType<typeof loadRun>>;

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

  // After the spend is recorded, never before: a hold released ahead of a
  // recorder that then fails would let the retry find the budget already
  // handed to someone else.
  await deps.releaseBudget?.({ projectId, runId });

  forgetPageProfile(runId);
  return { costUsd, priceUsd };
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
