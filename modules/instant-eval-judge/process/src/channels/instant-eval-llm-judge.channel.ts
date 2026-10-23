/**
 * The router's LLM legs, on LangWatch's keys: one yes-or-no question per call. It never throws
 * for a provider failure: each one is a skip naming the platform's reason, never the provider's
 * text. @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalBooleanQuestion,
  InstantEvalJudgeJob,
  InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import { Secret } from "@langwatch/secrets";

import type { InstantEvalLlmJudgeWire } from "../rules/instant-eval-llm-judge-wire.rules.ts";

/** LangWatch's Anthropic key for the router's Haiku leg; read on LangWatch Cloud only. */
export const llmJudgeAnthropicApiKey = Secret.load("INSTANT_EVAL_ANTHROPIC_API_KEY", {
  optional: true,
});

/** LangWatch's OpenAI key for the router's Responses leg; read on LangWatch Cloud only. */
export const llmJudgeOpenAiApiKey = Secret.load("INSTANT_EVAL_OPENAI_API_KEY", { optional: true });

export interface InstantEvalLlmJudgeRequest {
  readonly wire: InstantEvalLlmJudgeWire;
  /** The provider's model id; absent, the wire's default. */
  readonly model?: string;
  readonly job: InstantEvalJudgeJob;
  readonly question: InstantEvalBooleanQuestion;
  readonly text: string;
  readonly timeoutMs: number;
}

/** A verdict with the tokens it billed, or a skip; a skip after a send still bills its tokens. */
export type InstantEvalLlmJudgeAnswer =
  | Readonly<{ outcome: "answered"; verdict: boolean; inputTokens: number; outputTokens: number }>
  | Readonly<{
      outcome: "skipped";
      reason: InstantEvalSkipReason;
      inputTokens: number;
      outputTokens: number;
    }>;

export interface InstantEvalLlmJudgeChannel {
  judge(
    request: InstantEvalLlmJudgeRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmJudgeAnswer>;
}
