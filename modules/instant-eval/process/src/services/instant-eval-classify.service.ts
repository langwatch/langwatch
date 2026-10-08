/**
 * One classification asked for on its own, outside any run: the search bar
 * routing a sentence. Counted, never metered — a question of a few hundred
 * tokens per Enter is below the spend spine's noise floor (ADR-144).
 * @see modules/instant-eval/specs/classifier.feature
 */

import type {
  InstantEvalClassifierLimits,
  InstantEvalJudgement,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { instantEvalCostUsd, instantEvalPriceUsd } from "@langwatch/instant-eval-judge-contract";

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
    signal,
  }: {
    projectId: string;
    text: string;
    questions: readonly InstantEvalQuestion[];
    signal?: AbortSignal;
  }): Promise<InstantEvalJudgement> {
    return this.judge.classify({ projectId, text, questions }, signal);
  }

  /** Priced at this judge's own rate, as main priced a hosted judgement. */
  priceOf({ inputTokens }: { inputTokens: number }): { costUsd: number; priceUsd: number } {
    const costUsd = instantEvalCostUsd({ inputTokens, pricing: this.judge.pricing });

    return { costUsd, priceUsd: instantEvalPriceUsd({ costUsd, pricing: this.judge.pricing }) };
  }

  /** The limits this judge publishes, which a query judged through it is trimmed to. */
  getJudgeLimits(): InstantEvalClassifierLimits {
    return this.judge.limits;
  }
}
