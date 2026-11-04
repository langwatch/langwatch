/**
 * A routed run's LLM leg: one call per question on the full text, in parallel, each billed as it
 * arrives. Only the caller's stop is rethrown, once every send has settled so a late answer is
 * billed first; any other throw is that question's skip.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalJudgeJob,
  InstantEvalQuestion,
  InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import type { Logger } from "@langwatch/observability";

import type { InstantEvalRateLimiter } from "../channels/instant-eval-classifier.channel.ts";
import type {
  InstantEvalLlmJudgeAnswer,
  InstantEvalLlmJudgeChannel,
  InstantEvalLlmJudgeRequest,
} from "../channels/instant-eval-llm-judge.channel.ts";
import {
  instantEvalJudgeLegPermitOf,
  type InstantEvalJudgeRoutedAnswer,
} from "../rules/instant-eval-judge-route.rules.ts";
import { findInstantEvalLlmVerdicts } from "../rules/instant-eval-judge-sureness.rules.ts";

type InstantEvalJudgeLlmCall = Pick<InstantEvalLlmJudgeRequest, "wire" | "model" | "timeoutMs">;

/** The answers read, and the last reason a question went unanswered. */
type InstantEvalJudgeLlmLegAnswers = Readonly<{
  answers: ReadonlyMap<string, InstantEvalJudgeRoutedAnswer>;
  reason: InstantEvalSkipReason;
}>;

type InstantEvalJudgeLlmLegInput = Readonly<{
  llmJudge: InstantEvalLlmJudgeChannel;
  limiter: InstantEvalRateLimiter;
  projectId: string;
  job: InstantEvalJudgeJob;
  /** The full trace: an LLM leg never reads a shorter view. */
  text: string;
  signal: AbortSignal | undefined;
  logger: Pick<Logger, "error">;
  /** Bills one answer's tokens into the run's spend. */
  paid: (spend: { inputTokens: number; outputTokens: number }) => void;
}>;

export class InstantEvalJudgeLlmLegService {
  private constructor(private readonly input: InstantEvalJudgeLlmLegInput) {}

  static create(input: InstantEvalJudgeLlmLegInput): InstantEvalJudgeLlmLegService {
    return new InstantEvalJudgeLlmLegService(input);
  }

  /** Each question's answer, taken as sure. */
  async ask({
    call,
    questions,
  }: {
    call: InstantEvalJudgeLlmCall;
    questions: readonly InstantEvalQuestion[];
  }): Promise<InstantEvalJudgeLlmLegAnswers> {
    const sends = questions.map((question) => this.askOne({ call, question }));
    // Every send settles before a stop is rethrown, so an answer landing after it is billed too.
    await Promise.allSettled(sends);
    const sent = await Promise.all(sends);
    const answers = new Map<string, InstantEvalJudgeRoutedAnswer>();
    let reason: InstantEvalSkipReason = "classifier_provider_unavailable";
    sent.forEach((answer, at) => {
      if (answer.outcome !== "answered") {
        reason = answer.reason;
        return;
      }
      const question = questions[at]!;
      const [verdict] = findInstantEvalLlmVerdicts({ question, value: answer });
      if (verdict) answers.set(question.id, { verdict, sureness: 1 });
      else reason = "classifier_failed";
    });
    return { answers, reason };
  }

  /** One question; each is a send of the full text, so each one draws on the limiter. */
  private async askOne({
    call,
    question,
  }: {
    call: InstantEvalJudgeLlmCall;
    question: InstantEvalQuestion;
  }): Promise<InstantEvalLlmJudgeAnswer> {
    const { llmJudge, limiter, projectId, job, text, signal } = this.input;
    try {
      const permit = instantEvalJudgeLegPermitOf({
        projectId,
        pool: "llm",
        text,
        questions: [question],
      });
      await limiter.acquire(permit, signal);
      const answer = await llmJudge.judge(
        { ...call, job, question, text },
        ...(signal ? [signal] : []),
      );
      this.input.paid({ inputTokens: answer.inputTokens, outputTokens: answer.outputTokens });
      return answer;
    } catch (error) {
      if (signal?.aborted) throw error;
      this.input.logger.error({ wire: call.wire, error }, "Instant Evals LLM judge leg threw");
      return { outcome: "skipped", reason: "classifier_failed", inputTokens: 0, outputTokens: 0 };
    }
  }
}
