import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  type InstantEvalJudgement,
  type InstantEvalJudgeRoutePricing,
} from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalClassifierChannel,
  InstantEvalRateLimiter,
} from "../../channels/instant-eval-classifier.channel.ts";
import type {
  InstantEvalHostedDecisionsChannel,
  InstantEvalHostedDecisionsRequest,
} from "../../channels/instant-eval-hosted-decisions.channel.ts";
import type {
  InstantEvalLlmJudgeAnswer,
  InstantEvalLlmJudgeChannel,
  InstantEvalLlmJudgeRequest,
  InstantEvalLlmToolCallAnswer,
  InstantEvalLlmToolCallRequest,
} from "../../channels/instant-eval-llm-judge.channel.ts";
import { InstantEvalJudgeRouterService } from "../../services/instant-eval-judge-router.service.ts";

type HostedDecisionsAnswer = (
  request: InstantEvalHostedDecisionsRequest,
  signal?: AbortSignal,
) => InstantEvalJudgement | Promise<InstantEvalJudgement>;

/** The hosted Decisions leg's twin: answers as scripted, or throws what it is given. */
export class ScriptedInstantEvalHostedDecisionsChannel implements InstantEvalHostedDecisionsChannel {
  readonly requests: InstantEvalHostedDecisionsRequest[] = [];

  private constructor(private readonly answer: HostedDecisionsAnswer) {}

  static create({
    answer,
  }: {
    answer: HostedDecisionsAnswer;
  }): ScriptedInstantEvalHostedDecisionsChannel {
    return new ScriptedInstantEvalHostedDecisionsChannel(answer);
  }

  async classify(
    request: InstantEvalHostedDecisionsRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    this.requests.push(request);
    return this.answer(request, signal);
  }
}

/** A provider that never answers: it rejects with the signal's reason once it is aborted. */
export function hangUntilAborted<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

type LlmJudgeAnswer = (
  request: InstantEvalLlmJudgeRequest,
  signal?: AbortSignal,
) => InstantEvalLlmJudgeAnswer | Promise<InstantEvalLlmJudgeAnswer>;

type LlmToolCallAnswer = (
  request: InstantEvalLlmToolCallRequest,
  signal?: AbortSignal,
) => InstantEvalLlmToolCallAnswer | Promise<InstantEvalLlmToolCallAnswer>;

const NO_TOOL_CALL: LlmToolCallAnswer = () => ({
  outcome: "skipped",
  reason: "classifier_not_configured",
  inputTokens: 0,
  outputTokens: 0,
});

/** The LLM legs' twin: answers each question or tool call as scripted and keeps every request. */
export class ScriptedInstantEvalLlmJudgeChannel implements InstantEvalLlmJudgeChannel {
  readonly requests: InstantEvalLlmJudgeRequest[] = [];
  readonly calls: InstantEvalLlmToolCallRequest[] = [];

  private constructor(
    private readonly answer: LlmJudgeAnswer,
    private readonly toolCall: LlmToolCallAnswer,
  ) {}

  static create({
    answer,
    toolCall = NO_TOOL_CALL,
  }: {
    answer: LlmJudgeAnswer;
    toolCall?: LlmToolCallAnswer;
  }): ScriptedInstantEvalLlmJudgeChannel {
    return new ScriptedInstantEvalLlmJudgeChannel(answer, toolCall);
  }

  async call(
    request: InstantEvalLlmToolCallRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmToolCallAnswer> {
    this.calls.push(request);
    return this.toolCall(request, signal);
  }

  isConfigured(): boolean {
    return true;
  }

  async judge(
    request: InstantEvalLlmJudgeRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmJudgeAnswer> {
    this.requests.push(request);
    return this.answer(request, signal);
  }
}

/** A router over the public jev-only table and prices, for a judge service a test never routes. */
export function publicInstantEvalJudgeRouter({
  classifier,
  limiter,
}: {
  classifier: InstantEvalClassifierChannel | undefined;
  limiter: InstantEvalRateLimiter;
}): { router: InstantEvalJudgeRouterService; routePricing: InstantEvalJudgeRoutePricing } {
  const routePricing = INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING;
  const router = InstantEvalJudgeRouterService.create({
    table: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
    pricing: routePricing,
    classifier,
    hostedDecisions: undefined,
    llmJudge: ScriptedInstantEvalLlmJudgeChannel.create({
      answer: () => ({
        outcome: "skipped",
        reason: "classifier_not_configured",
        inputTokens: 0,
        outputTokens: 0,
      }),
    }),
    limiter,
  });
  return { router, routePricing };
}
