/**
 * The judge a deployment with LangWatch's classifier key judges with: the Instant Evals judge's
 * own client, reached through its Api (ADR-174 decision 13). Runs and judged queries record their
 * spend through the judge afterwards, and the search bar records none, so this is never metered.
 * @see modules/instant-eval/specs/classifier.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  INSTANT_EVAL_PRICING,
  type InstantEvalJudgeApi,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../channels/instant-eval-judging.channel.ts";

export class InstantEvalCloudJudgeService implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  private constructor(private readonly judges: Pick<InstantEvalJudgeApi, "classify">) {}

  static create({
    judges,
  }: {
    judges: Pick<InstantEvalJudgeApi, "classify">;
  }): InstantEvalCloudJudgeService {
    return new InstantEvalCloudJudgeService(judges);
  }

  classify(
    { projectId, text, questions }: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    return this.judges.classify({ projectId, text, questions, ...(signal ? { signal } : {}) });
  }
}
