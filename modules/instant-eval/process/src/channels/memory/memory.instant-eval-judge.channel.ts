/**
 * The judge a deployment without a key gets: every question is skipped, so
 * the judged columns come back null with a diagnostic rather than the query
 * being refused. A null object, so the caller has one code path.
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalJudgement,
  instantEvalSkipped,
} from "@langwatch/instant-eval-contract";

import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import type { InstantEvalJudgeChannel } from "../instant-eval-judge.channel.ts";

export class MemoryInstantEvalJudgeChannel implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  private constructor() {}

  static create(): MemoryInstantEvalJudgeChannel {
    return new MemoryInstantEvalJudgeChannel();
  }

  async classify(): Promise<InstantEvalJudgement> {
    return instantEvalSkipped("classifier_not_configured");
  }
}

/** A limiter that never waits, for the memory judge and for suites. */
export class MemoryInstantEvalRateLimiterChannel {
  private constructor() {}

  static create(): MemoryInstantEvalRateLimiterChannel {
    return new MemoryInstantEvalRateLimiterChannel();
  }

  async acquire(): Promise<void> {
    // Nothing is sent, so nothing has to be paced.
  }
}
