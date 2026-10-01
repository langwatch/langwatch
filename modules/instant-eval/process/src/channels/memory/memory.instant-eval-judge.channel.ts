/**
 * The judge a deployment without a key gets: every question is skipped, so
 * the judged columns come back null with a diagnostic rather than the query
 * being refused. A null object, so the caller has one code path.
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
  type InstantEvalVerdict,
  instantEvalSkipped,
} from "@langwatch/instant-eval-contract";

import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import { estimateInstantEvalRequestTokens } from "../../rules/instant-eval-token-budget.rules.ts";
import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgeChannel,
} from "../instant-eval-judge.channel.ts";

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

/**
 * The stand-in judge `INSTANT_EVAL_CLASSIFIER=memory` selects outside production: every
 * question answered from a hash of the text and its id, so a run completes, renders and
 * repeats exactly, and nothing leaves the process.
 */
export class DeterministicInstantEvalJudgeChannel implements InstantEvalJudgeChannel {
  readonly limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
  readonly pricing = INSTANT_EVAL_PRICING;

  private constructor() {}

  static create(): DeterministicInstantEvalJudgeChannel {
    return new DeterministicInstantEvalJudgeChannel();
  }

  async classify({ text, questions }: InstantEvalClassifyRequest): Promise<InstantEvalJudgement> {
    return {
      verdicts: questions.map((question) =>
        verdictOf({ question, draw: drawOf(`${question.id}\u0000${text}`) }),
      ),
      inputTokens: estimateInstantEvalRequestTokens({ text, questions, limits: this.limits }),
      isTextTruncated: false,
    };
  }
}

/** FNV-1a over the string, scaled to [0, 1): stable across processes and releases. */
function drawOf(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash / 2 ** 32;
}

function verdictOf({
  question,
  draw,
}: {
  question: InstantEvalQuestion;
  draw: number;
}): InstantEvalVerdict {
  if (question.kind === "boolean") return { questionId: question.id, probability: draw };
  if (question.kind === "score") {
    const { min, max } = question.range;
    return { questionId: question.id, score: min + draw * (max - min) };
  }
  const chosen = question.options[Math.floor(draw * question.options.length)]?.name ?? "";
  return {
    questionId: question.id,
    label: chosen,
    probabilities: Object.fromEntries(
      question.options.map(({ name }) => [name, name === chosen ? 1 : 0]),
    ),
  };
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
