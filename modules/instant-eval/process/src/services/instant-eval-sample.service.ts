/**
 * A few of a run's rows, with the text that was judged beside the verdict. The
 * text is re-read through the statement's own extraction functions rather than
 * stored, and nothing is judged again, which is what makes a sample free.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";
import { INSTANT_EVAL_SAMPLE_CEILING } from "@langwatch/instant-eval-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalJudgment,
  InstantEvalJudgmentsRepository,
} from "../repositories/instant-eval-judgments.repository.ts";
import type { InstantEvalRunRow } from "../repositories/instant-eval-run.repository.ts";
import { instantEvalWrittenWindow } from "../rules/instant-eval-judgments.rules.ts";
import { readInstantEvalRunQuestions } from "../rules/instant-eval-run-questions.rules.ts";
import { instantEvalHydrationPlan } from "../rules/instant-eval-run-sizing.rules.ts";
import type { InstantEvalTextSource } from "./instant-eval-estimate.service.ts";

/** A few of a run's rows: the texts that were judged, and the verdicts on them. */
export interface InstantEvalSample {
  readonly rows: readonly Record<string, unknown>[];
  readonly judgments: readonly InstantEvalJudgment[];
}

export class InstantEvalSampleService {
  private constructor(
    private readonly judgments: InstantEvalJudgmentsRepository,
    private readonly textSource: InstantEvalTextSource,
    private readonly now: () => Instant,
    private readonly seed: () => number,
  ) {}

  static create({
    judgments,
    textSource,
    now = nowInstant,
    seed,
  }: {
    judgments: InstantEvalJudgmentsRepository;
    textSource: InstantEvalTextSource;
    now?: () => Instant;
    /** Varies which rows a repeated read picks. Injected so a test pins it. */
    seed?: () => number;
  }): InstantEvalSampleService {
    return new InstantEvalSampleService(
      judgments,
      textSource,
      now,
      seed ?? (() => nowInstant().epochMilliseconds),
    );
  }

  /**
   * The rows vary between calls and a boolean question shows its matches first:
   * the same lowest trace ids every time answer for one corner of the run only.
   */
  async getSample({
    caller,
    protections,
    projectId,
    runId,
    row,
    rows,
  }: {
    caller: LangWatchQLCaller;
    protections: LangWatchQLProtections;
    projectId: string;
    runId: string;
    row: InstantEvalRunRow;
    rows: number;
  }): Promise<InstantEvalSample> {
    const questions = readInstantEvalRunQuestions(row.questions);
    const judged = await this.judgments.findSample({
      projectId,
      runId,
      ...instantEvalWrittenWindow(row, this.now()),
      traces: Math.max(1, Math.min(rows, INSTANT_EVAL_SAMPLE_CEILING)),
      shouldPreferMatched: questions.some((question) => question.kind === "boolean"),
      seed: this.seed(),
    });
    const traceIds = [...new Set(judged.map((judgment) => judgment.traceId))];
    if (traceIds.length === 0) return { rows: [], judgments: judged };

    const texts = await this.textSource.texts({
      project: caller,
      protections,
      sql: row.sql,
      parameters: row.parameters,
      calls: instantEvalHydrationPlan(row.plan),
      traceIds,
    });

    return {
      rows: texts,
      judgments: judged.filter((judgment) => traceIds.includes(judgment.traceId)),
    };
  }
}
