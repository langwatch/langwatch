/**
 * The router's LLM legs, on LangWatch's keys: one question per call, of any kind. It never throws
 * for a provider failure: each one is a skip naming the platform's reason, never the provider's
 * text. @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalJudgeJob,
  InstantEvalJudgeReasoningEffort,
  InstantEvalQuestion,
  InstantEvalScenarioJudgeTool,
  InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import { Secret } from "@langwatch/secrets";

import type { InstantEvalLlmJudgeValue } from "../rules/instant-eval-judge-sureness.rules.ts";
import type { InstantEvalLlmJudgeWire } from "../rules/instant-eval-llm-judge-wire.rules.ts";

/** LangWatch's Anthropic key for the router's Anthropic legs; read on LangWatch Cloud only. */
export const llmJudgeAnthropicApiKey = Secret.load("INSTANT_EVAL_ANTHROPIC_API_KEY", {
  optional: true,
});

/** LangWatch's OpenAI key for the router's OpenAI Responses legs; read on LangWatch Cloud only. */
export const llmJudgeOpenAiApiKey = Secret.load("INSTANT_EVAL_OPENAI_API_KEY", { optional: true });

/** LangWatch's Gemini key for the router's Gemini legs; read on LangWatch Cloud only. */
export const llmJudgeGeminiApiKey = Secret.load("INSTANT_EVAL_GEMINI_API_KEY", { optional: true });

export interface InstantEvalLlmJudgeRequest {
  readonly wire: InstantEvalLlmJudgeWire;
  /** The provider's model id, from the route table; there is no default. */
  readonly model: string;
  readonly job: InstantEvalJudgeJob;
  readonly question: InstantEvalQuestion;
  readonly text: string;
  readonly timeoutMs: number;
  /** From the route table's backend; absent, the request names no effort. */
  readonly reasoningEffort?: InstantEvalJudgeReasoningEffort;
  /** From the route table's backend; absent, the leg's default output cap. */
  readonly maxOutputTokens?: number;
}

/**
 * The question's answer (`verdict` for yes or no, `score`, or `label`) with the tokens it billed,
 * or a skip; a skip after a send still bills its tokens. `isUsageUnread`: the call went out but no
 * usage came back (a timeout or a lost socket), so what the provider charged is unknown.
 */
export type InstantEvalLlmJudgeAnswer =
  | (Readonly<{ outcome: "answered"; inputTokens: number; outputTokens: number }> &
      InstantEvalLlmJudgeValue)
  | Readonly<{
      outcome: "skipped";
      reason: InstantEvalSkipReason;
      inputTokens: number;
      outputTokens: number;
      isUsageUnread?: boolean;
    }>;

/** A caller's own tool call, sent whole: the scenario judge's verdict or its turn decision. */
export interface InstantEvalLlmToolCallRequest {
  readonly wire: InstantEvalLlmJudgeWire;
  /** The provider's model id, from the route table; there is no default. */
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly tools: readonly InstantEvalScenarioJudgeTool[];
  /** The one tool the model must call; absent, it must call one of `tools`. */
  readonly forcedTool?: string;
  readonly timeoutMs: number;
  /** From the route table's backend; absent, the request names no effort. */
  readonly reasoningEffort?: InstantEvalJudgeReasoningEffort;
  /** From the route table's backend; absent, the wire's default output cap. */
  readonly maxOutputTokens?: number;
}

/** The tool called with its arguments and the tokens billed, or a skip that may still bill. */
export type InstantEvalLlmToolCallAnswer =
  | Readonly<{
      outcome: "answered";
      tool: string;
      input: unknown;
      inputTokens: number;
      outputTokens: number;
    }>
  | Readonly<{
      outcome: "skipped";
      reason: InstantEvalSkipReason;
      inputTokens: number;
      outputTokens: number;
    }>;

export interface InstantEvalLlmJudgeChannel {
  /** Whether this install holds LangWatch's key for the wire. */
  isConfigured(wire: InstantEvalLlmJudgeWire): boolean;
  judge(
    request: InstantEvalLlmJudgeRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmJudgeAnswer>;
  /** One send of the caller's own messages and tools; never a retry. */
  call(
    request: InstantEvalLlmToolCallRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalLlmToolCallAnswer>;
}
