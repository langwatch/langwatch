/**
 * One classification asked for on its own, outside any run: the search bar
 * routing a sentence. Counted, never metered — a question of a few hundred
 * tokens per Enter is below the spend spine's noise floor (ADR-144).
 * @see specs/instant-evals/classifier.feature
 */

import type { InstantEvalJudgement, InstantEvalQuestion } from "@langwatch/instant-eval-contract";

import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judge.channel.ts";

export class InstantEvalClassifyService {
  private constructor(private readonly judge: InstantEvalJudgeChannel) {}

  static create({ judge }: { judge: InstantEvalJudgeChannel }): InstantEvalClassifyService {
    return new InstantEvalClassifyService(judge);
  }

  /**
   * Skips rather than refuses when the judge is unusable, so the caller falls
   * back to its own route instead of failing the read that carries it.
   */
  async classify({
    projectId,
    text,
    questions,
  }: {
    projectId: string;
    text: string;
    questions: readonly InstantEvalQuestion[];
  }): Promise<InstantEvalJudgement> {
    return this.judge.classify({ projectId, text, questions });
  }
}
