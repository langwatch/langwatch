/**
 * Reading a run back: its judgements page by page, and a sample of the rows
 * with the text that was judged beside the verdict.
 *
 * Separate from the service because these two are the only operations that
 * read the judgement store rather than the run's own row, and the sample is
 * the only one that re-executes the caller's statement after the run is over.
 *
 * @see ./instant-eval-judgments.repository.ts
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import type { Protections } from "~/server/traces/protections";
import { INSTANT_EVAL_SAMPLE_CEILING } from "./caps";
import type {
  InstantEvalJudgment,
  InstantEvalJudgmentPage,
  InstantEvalJudgmentsRepository,
} from "./instant-eval-judgments.repository";
import { instantEvalHydrationPlan } from "./instant-eval-run.executor";
import type { InstantEvalJudgmentStatus } from "./judgments";
import { readInstantEvalRunQuestions } from "./questions";
import type { InstantEvalRowSource, InstantEvalRunCaller } from "./row-source";

/** The fields of a run's row these reads need, and no others. */
export interface InstantEvalRunReadRow {
  readonly sql: string;
  readonly parameters: unknown;
  readonly questions: unknown;
  readonly plan: unknown;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

/** The window a run's judgements were written in. */
function writtenWindow(row: InstantEvalRunReadRow, now: number) {
  return {
    // The run's own timestamps bound the read, which is what lets it prune
    // partitions instead of walking every month the table holds.
    writtenFrom: row.startedAt ?? row.createdAt,
    writtenUntil: row.finishedAt ?? new Date(now),
  };
}

/** One page of the run's judgements. */
export async function readInstantEvalResults({
  judgments,
  projectId,
  runId,
  row,
  now,
  limit,
  questionId,
  isMatched,
  status,
  cursor,
}: {
  judgments: InstantEvalJudgmentsRepository;
  projectId: string;
  runId: string;
  row: InstantEvalRunReadRow;
  now: number;
  limit: number;
  questionId?: string;
  isMatched?: boolean;
  status?: InstantEvalJudgmentStatus;
  cursor?: string;
}): Promise<InstantEvalJudgmentPage> {
  return await judgments.page({
    projectId,
    runId,
    ...writtenWindow(row, now),
    limit,
    ...(questionId === undefined ? {} : { questionId }),
    ...(isMatched === undefined ? {} : { matched: isMatched }),
    ...(status === undefined ? {} : { status }),
    ...(cursor === undefined ? {} : { cursor }),
  });
}

/**
 * A few of the run's rows, with the text that was judged beside the verdict.
 *
 * The text is re-read through the statement's extraction functions rather than
 * stored, and no row is judged again, which is what makes reading a sample
 * free. The verdicts come from the judgements the run already wrote.
 *
 * The rows vary between calls, and a run with a boolean question shows its
 * matches first: what a caller checks with a sample is whether the run
 * answered the question they meant to ask, and reading the same lowest trace
 * ids every time answers that for one corner of the run only.
 */
export async function readInstantEvalSample({
  judgments,
  rowSource,
  caller,
  protections,
  projectId,
  runId,
  row,
  now,
  seed,
  n,
}: {
  judgments: InstantEvalJudgmentsRepository;
  rowSource: InstantEvalRowSource;
  caller: InstantEvalRunCaller;
  protections: Protections;
  projectId: string;
  runId: string;
  row: InstantEvalRunReadRow;
  now: number;
  seed: number;
  n: number;
}): Promise<{
  rows: readonly Record<string, unknown>[];
  judgments: readonly InstantEvalJudgment[];
}> {
  const count = Math.max(1, Math.min(n, INSTANT_EVAL_SAMPLE_CEILING));
  const questions = readInstantEvalRunQuestions(row.questions);
  const judged = await judgments.sample({
    projectId,
    runId,
    ...writtenWindow(row, now),
    traces: count,
    preferMatched: questions.some((question) => question.kind === "boolean"),
    seed,
  });
  const traceIds = [...new Set(judged.map((judgment) => judgment.traceId))];
  if (traceIds.length === 0) return { rows: [], judgments: judged };

  const rows = await rowSource.texts({
    caller,
    protections,
    sql: row.sql,
    parameters: (row.parameters ?? {}) as Record<string, unknown>,
    calls: instantEvalHydrationPlan(row.plan),
    traceIds,
  });
  return {
    rows,
    judgments: judged.filter((judgment) => traceIds.includes(judgment.traceId)),
  };
}
