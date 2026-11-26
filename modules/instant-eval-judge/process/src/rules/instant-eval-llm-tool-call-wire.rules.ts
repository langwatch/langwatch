/**
 * A caller's own tool call on an LLM leg's wire: the scenario judge's verdict or turn decision,
 * sent with its own messages and tools instead of the router's `evaluation` tool. One tool is
 * forced by name, or any of the offered ones must be called.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */

import {
  INSTANT_EVAL_JUDGE_REASONING_MAX_OUTPUT_TOKENS,
  isInstantEvalJudgeReasoning,
  type InstantEvalJudgeReasoningEffort,
  type InstantEvalScenarioJudgeTool,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

import {
  instantEvalGeminiBodyOf,
  readInstantEvalGeminiAnswer,
} from "./instant-eval-gemini-wire.rules.ts";
import type { InstantEvalLlmJudgeWire } from "./instant-eval-llm-judge-wire.rules.ts";

const MAX_OUTPUT_TOKENS = 8_000;

/** Content an LLM leg keeps, as langevals' judge fit does; the long-context wire keeps more. */
const LLM_CONTENT_BUDGET_TOKENS = 128_000;
const GEMINI_CONTENT_BUDGET_TOKENS = 900_000;

/** The content one LLM call keeps on its wire; its channel and its worst case share it. */
export function instantEvalLlmContentBudgetTokensOf(wire: InstantEvalLlmJudgeWire): number {
  return wire === "gemini_generate_content"
    ? GEMINI_CONTENT_BUDGET_TOKENS
    : LLM_CONTENT_BUDGET_TOKENS;
}

/**
 * The output cap one LLM call is sent with: the most output tokens it can be billed for. The
 * backend's own cap where the table sets one, else the reasoning cap where an effort is set.
 */
export function instantEvalLlmJudgeMaxOutputTokensOf({
  wire,
  reasoningEffort,
  maxOutputTokens,
}: {
  wire: InstantEvalLlmJudgeWire;
  reasoningEffort?: InstantEvalJudgeReasoningEffort | undefined;
  maxOutputTokens?: number | undefined;
}): number {
  if (maxOutputTokens !== undefined) return maxOutputTokens;
  return wire === "openai_responses" && isInstantEvalJudgeReasoning(reasoningEffort)
    ? INSTANT_EVAL_JUDGE_REASONING_MAX_OUTPUT_TOKENS
    : MAX_OUTPUT_TOKENS;
}

export interface InstantEvalLlmToolCallPrompt {
  readonly system: string;
  readonly user: string;
  readonly tools: readonly InstantEvalScenarioJudgeTool[];
  /** The one tool the model must call; absent, it must call one of `tools`. */
  readonly forcedTool?: string;
}

/**
 * A reasoning effort goes on OpenAI Responses alone, only when the backend sets one. The output
 * cap is the backend's own, else a reasoning-sized one under an effort (`...MaxOutputTokensOf`).
 */
export function instantEvalLlmToolCallBodyOf({
  wire,
  model,
  prompt,
  reasoningEffort,
  maxOutputTokens,
}: {
  wire: InstantEvalLlmJudgeWire;
  model: string;
  prompt: InstantEvalLlmToolCallPrompt;
  reasoningEffort?: InstantEvalJudgeReasoningEffort;
  maxOutputTokens?: number;
}): Record<string, unknown> {
  const { system, user, tools, forcedTool } = prompt;
  const cap = instantEvalLlmJudgeMaxOutputTokensOf({ wire, reasoningEffort, maxOutputTokens });
  if (wire === "anthropic_messages") {
    return {
      model,
      max_tokens: cap,
      system,
      messages: [{ role: "user", content: user }],
      tools: tools.map(({ name, description, parameters }) => ({
        name,
        description,
        input_schema: parameters,
      })),
      tool_choice: forcedTool ? { type: "tool", name: forcedTool } : { type: "any" },
    };
  }
  if (wire === "gemini_generate_content") {
    return instantEvalGeminiBodyOf({
      system,
      user,
      tools,
      allowed: forcedTool ? [forcedTool] : tools.map((tool) => tool.name),
      maxOutputTokens: cap,
    });
  }
  return {
    model,
    input: [
      { role: "developer", content: system },
      { role: "user", content: user },
    ],
    max_output_tokens: cap,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    store: false,
    tools: tools.map((tool) => ({ type: "function", ...tool, strict: false })),
    tool_choice: forcedTool ? { type: "function", name: forcedTool } : "required",
  };
}

const usageSchema = z
  .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
  .optional();

const anthropicResponseSchema = z.object({
  content: z.array(
    z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() }),
  ),
  usage: usageSchema,
});

const openAiResponseSchema = z.object({
  status: z.string().optional(),
  incomplete_details: z.object({ reason: z.string().optional() }).nullish(),
  output: z.array(
    z.object({ type: z.string(), name: z.string().optional(), arguments: z.string().optional() }),
  ),
  usage: usageSchema,
});

/**
 * The tool the model called with its arguments, or none, and the tokens billed either way. An
 * OpenAI answer the provider marked incomplete names why in `stoppedBy` (e.g. `max_output_tokens`).
 */
export type InstantEvalLlmToolCallReading = Readonly<{
  inputTokens: number;
  outputTokens: number;
}> &
  (
    | Readonly<{ outcome: "called"; tool: string; input: unknown }>
    | Readonly<{ outcome: "none"; stoppedBy?: string }>
  );

/** The first call of an offered tool; a call of any other name is no answer. */
export function readInstantEvalLlmToolCall({
  wire,
  body,
  tools,
}: {
  wire: InstantEvalLlmJudgeWire;
  body: unknown;
  tools: readonly string[];
}): InstantEvalLlmToolCallReading {
  if (wire === "anthropic_messages") {
    const parsed = anthropicResponseSchema.safeParse(body);
    if (!parsed.success) return { outcome: "none", inputTokens: 0, outputTokens: 0 };
    const usage = usageOf(parsed.data.usage);
    const call = parsed.data.content.find(
      (part) => part.type === "tool_use" && part.name !== undefined && tools.includes(part.name),
    );
    if (!call?.name) return { outcome: "none", ...usage };
    return { outcome: "called", tool: call.name, input: call.input, ...usage };
  }
  if (wire === "gemini_generate_content") {
    const { calls, ...usage } = readInstantEvalGeminiAnswer(body);
    const call = calls.find((one) => tools.includes(one.name));
    if (!call) return { outcome: "none", ...usage };
    return { outcome: "called", tool: call.name, input: call.args, ...usage };
  }
  const parsed = openAiResponseSchema.safeParse(body);
  if (!parsed.success) return { outcome: "none", inputTokens: 0, outputTokens: 0 };
  const { status, incomplete_details } = parsed.data;
  const usage = usageOf(parsed.data.usage);
  const none = {
    outcome: "none",
    ...(status === "incomplete" ? { stoppedBy: incomplete_details?.reason ?? "incomplete" } : {}),
    ...usage,
  } as const;
  const call = parsed.data.output.find(
    (item) => item.type === "function_call" && item.name !== undefined && tools.includes(item.name),
  );
  if (!call?.name) return none;
  const input = argumentsOf(call.arguments);
  if (input === undefined) return none;
  return { outcome: "called", tool: call.name, input, ...usage };
}

function argumentsOf(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function usageOf(usage: z.infer<typeof usageSchema>) {
  return { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 };
}
