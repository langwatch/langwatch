/**
 * Judging rows whose judged columns hold text: one request per distinct text of a row, a fixed
 * number in flight, a stop that keeps what was answered. Shared by a run's page and a query.
 * @see modules/instant-eval/specs/instant-eval-pipeline.feature
 * @see specs/lwql/eval-functions.feature
 */

import { InstantEvalClassifierUnavailableError } from "@langwatch/instant-eval-contract";
import {
  type InstantEvalJudgement,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";

import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judge.channel.ts";
import {
  assertInstantEvalPageBudget,
  instantEvalJudgedRows,
  instantEvalJudgementUnits,
  instantEvalPageTokenBudget,
  type InstantEvalJudgementUnit,
} from "../rules/instant-eval-judge-page.rules.ts";
import type { InstantEvalRunQuestion } from "../rules/instant-eval-run-questions.rules.ts";

/**
 * Classifications one batch of rows keeps in flight. High enough that the judge's own token
 * bucket, rather than the number of open requests, is what it waits on: at about 250 ms a
 * call, thirty-two could never reach that rate.
 */
export const INSTANT_EVAL_JUDGE_CONCURRENCY = 128;

/** What the requests sent and what they cost. */
export interface InstantEvalJudgeUsage {
  requests: number;
  inputTokens: number;
  skipped: Record<string, number>;
  limiterWaitMs: number;
}

/** The rows as they are written, and what judging them sent. */
export interface InstantEvalRowsJudgement {
  readonly rows: readonly Record<string, unknown>[];
  readonly usage: InstantEvalJudgeUsage;
  /** Present when a stop reached the rows, naming the ones it left unjudged. */
  readonly cancellation?: { readonly unjudgedRows: readonly number[] };
}

export class InstantEvalJudgeRowsService {
  private constructor(
    private readonly judge: InstantEvalJudgeChannel,
    private readonly concurrency: number,
  ) {}

  static create({
    judge,
    concurrency = INSTANT_EVAL_JUDGE_CONCURRENCY,
  }: {
    judge: InstantEvalJudgeChannel;
    concurrency?: number;
  }): InstantEvalJudgeRowsService {
    return new InstantEvalJudgeRowsService(judge, concurrency);
  }

  /**
   * One request per text, at most {@link concurrency} in flight. `tokenBudget` caps the whole
   * batch before anything is sent; absent, it is a page's (the judge's state per row).
   */
  async judgeRows({
    projectId,
    rows,
    questions,
    tokenBudget,
    signal,
  }: {
    projectId: string;
    rows: readonly Record<string, unknown>[];
    questions: readonly InstantEvalRunQuestion[];
    tokenBudget?: number;
    signal: AbortSignal | null;
  }): Promise<InstantEvalRowsJudgement> {
    const { limits } = this.judge;
    const units = instantEvalJudgementUnits({ rows, questions, limits });
    assertInstantEvalPageBudget({
      units,
      budget: tokenBudget ?? instantEvalPageTokenBudget({ rows: rows.length, limits }),
      limits,
    });

    const usage: InstantEvalJudgeUsage = {
      requests: 0,
      inputTokens: 0,
      skipped: {},
      limiterWaitMs: 0,
    };
    const cells = new Map<number, Map<string, InstantEvalVerdict | null>>();
    let failures = 0;
    const isCancelled = await inParallel({
      items: units,
      limit: this.concurrency,
      signal,
      run: async (unit) => {
        const judgement = await this.#classify({ projectId, unit, signal });
        if (judgement === null) failures += 1;
        record({ unit, judgement: judgement ?? LOST_JUDGEMENT, cells, usage });
      },
    });
    // Every unit failing is not a row-level problem: it is the judge not
    // answering at all, and rows of nulls would read as "nothing matched".
    if (failures > 0 && failures === units.length) {
      throw new InstantEvalClassifierUnavailableError();
    }

    const judged = instantEvalJudgedRows({ rows, questions, cells });

    return {
      rows: judged.rows,
      usage,
      ...(isCancelled ? { cancellation: { unjudgedRows: judged.unjudgedRows } } : {}),
    };
  }

  /**
   * One unit's judgement, or null when the judge could not be used. A stop is
   * rethrown rather than counted: swallowing it would turn an abandoned batch
   * into nulls and let the remaining units keep spending.
   */
  async #classify({
    projectId,
    unit,
    signal,
  }: {
    projectId: string;
    unit: InstantEvalJudgementUnit;
    signal: AbortSignal | null;
  }): Promise<InstantEvalJudgement | null> {
    try {
      return await this.judge.classify(
        {
          projectId,
          text: unit.text,
          questions: unit.questions.map((question) => question.question),
        },
        signal ?? undefined,
      );
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;

      return null;
    }
  }
}

/** What a unit the judge lost is recorded as: a skip, with the reason. */
const LOST_JUDGEMENT: InstantEvalJudgement = {
  verdicts: [],
  skippedReason: "classifier_failed",
  inputTokens: 0,
  isTextTruncated: false,
};

/**
 * One answer, filed. Every question of the unit gets a cell — null where the
 * judgement carries no verdict for it — because a question that was asked and
 * declined is a null the caller explains, not one a stop left behind.
 */
function record({
  unit,
  judgement,
  cells,
  usage,
}: {
  unit: InstantEvalJudgementUnit;
  judgement: InstantEvalJudgement;
  cells: Map<number, Map<string, InstantEvalVerdict | null>>;
  usage: InstantEvalJudgeUsage;
}): void {
  usage.requests += 1;
  usage.inputTokens += judgement.inputTokens;
  usage.limiterWaitMs += judgement.limiterWaitMs ?? 0;
  if (judgement.skippedReason) {
    usage.skipped[judgement.skippedReason] = (usage.skipped[judgement.skippedReason] ?? 0) + 1;
  }

  const byQuestion = new Map(judgement.verdicts.map((verdict) => [verdict.questionId, verdict]));
  const row = cells.get(unit.rowIndex) ?? new Map<string, InstantEvalVerdict | null>();
  for (const question of unit.questions) {
    row.set(question.id, byQuestion.get(question.id) ?? null);
  }
  cells.set(unit.rowIndex, row);
}

/** Whether a thrown value is a stop rather than a failure. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * Runs the units with a fixed number in flight, answering whether a stop ended
 * the scheduling. A stop settles what is in flight rather than throwing: a
 * unit already answered was paid for, and its verdict is kept.
 */
async function inParallel<T>({
  items,
  limit,
  run,
  signal,
}: {
  items: readonly T[];
  limit: number;
  run: (item: T) => Promise<void>;
  signal: AbortSignal | null;
}): Promise<boolean> {
  let next = 0;
  const take = () => items[next++];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
      drain({ take, run, signal }),
    ),
  );

  return signal?.aborted === true;
}

/**
 * One worker: takes units until there are none, or until the signal fires.
 * Checked between units as well as inside the request, so rows the caller
 * walked away from stop before the next classification.
 */
async function drain<T>({
  take,
  run,
  signal,
}: {
  take: () => T | undefined;
  run: (item: T) => Promise<void>;
  signal: AbortSignal | null;
}): Promise<void> {
  while (!signal?.aborted) {
    const item = take();
    if (item === undefined) return;
    if (await runOrStop({ item, run, signal })) return;
  }
}

/**
 * Runs one unit; true when the stop ended it, which ends the worker too. Only
 * the caller's own signal is a stop: an abort the judge raised on its own is a
 * failed unit, and swallowing it would read as a judge answering nulls.
 */
async function runOrStop<T>({
  item,
  run,
  signal,
}: {
  item: T;
  run: (item: T) => Promise<void>;
  signal: AbortSignal | null;
}): Promise<boolean> {
  try {
    await run(item);

    return false;
  } catch (error) {
    if (signal?.aborted) return true;
    throw error;
  }
}
