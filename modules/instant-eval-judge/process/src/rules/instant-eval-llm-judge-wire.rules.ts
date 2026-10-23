/**
 * The LLM legs' request and answer: one yes-or-no question as a forced `evaluation` tool call,
 * on Anthropic Messages or OpenAI Responses. The verdict is read from the tool's `result`.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalBooleanQuestion,
  InstantEvalJudgeJob,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

const INSTANT_EVAL_LLM_JUDGE_WIRES = ["anthropic_messages", "openai_responses"] as const;
export type InstantEvalLlmJudgeWire = (typeof INSTANT_EVAL_LLM_JUDGE_WIRES)[number];

const SEARCH_SYSTEM_PROMPT =
  "You are an LLM evaluator answering a yes/no question about a trace or conversation";

const RESULT_FRAMING = [
  "Answer by calling the `evaluation` function, setting `result` to exactly the true or false",
  "value the instructions above ask you to return. If they say when to return false, return",
  "false in that case and true in every other case. If they say when to return true, return",
  "true in that case and false in every other case. `result` is not a rating of the output,",
  "never invert it.",
].join(" ");

const EVALUATION_TOOL = {
  name: "evaluation",
  description:
    "Record the true or false value the instructions ask for, with a short justification that cites the evidence in the content.",
  parameters: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "A short justification, written before the result: the condition the instructions give, the evidence in the content that settles it (quote the values or name the tool result), and the value that follows.",
      },
      result: {
        type: "boolean",
        description:
          "Exactly the value the instructions ask you to return. If they say when to return false: false in that case, true otherwise. If they say when to return true: true in that case, false otherwise. Not a judgment of whether the content is good.",
      },
    },
    required: ["reasoning", "result"],
  },
} as const;

const MAX_OUTPUT_TOKENS = 8_000;

/** The system and user messages: a search question is asked as a task, an evaluator as itself. */
export function instantEvalLlmJudgeMessagesOf({
  job,
  question,
  text,
}: {
  job: InstantEvalJudgeJob;
  question: InstantEvalBooleanQuestion;
  text: string;
}): { system: string; user: string } {
  const asked = questionText(question);
  const isEvaluator = job === "llm_judge";
  const system = isEvaluator ? asked : SEARCH_SYSTEM_PROMPT;
  const task = isEvaluator
    ? asked
    : `Answer this question about the text above with true (yes) or false (no): ${asked}`;
  return { system: `${system}\n\n${RESULT_FRAMING}`, user: `# Input\n${text}\n\n# Task\n${task}` };
}

function questionText(question: InstantEvalBooleanQuestion): string {
  const { criteria } = question;
  return criteria
    ? `${question.instructions}\nReturn true if: ${criteria[0]}\nReturn false if: ${criteria[1]}`
    : question.instructions;
}

export function instantEvalLlmJudgeBodyOf({
  wire,
  model,
  system,
  user,
}: {
  wire: InstantEvalLlmJudgeWire;
  model: string;
  system: string;
  user: string;
}): Record<string, unknown> {
  if (wire === "anthropic_messages") {
    return {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: EVALUATION_TOOL.name,
          description: EVALUATION_TOOL.description,
          input_schema: EVALUATION_TOOL.parameters,
        },
      ],
      tool_choice: { type: "tool", name: EVALUATION_TOOL.name },
    };
  }
  return {
    model,
    input: [
      { role: "developer", content: system },
      { role: "user", content: user },
    ],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
    tools: [{ type: "function", ...EVALUATION_TOOL, strict: false }],
    tool_choice: { type: "function", name: EVALUATION_TOOL.name },
  };
}

const resultSchema = z.object({ result: z.union([z.boolean(), z.enum(["true", "false"])]) });

const anthropicResponseSchema = z.object({
  content: z.array(
    z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() }),
  ),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

const openAiResponseSchema = z.object({
  output: z.array(
    z.object({ type: z.string(), name: z.string().optional(), arguments: z.string().optional() }),
  ),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

type Verdict = Readonly<{ outcome: "verdict"; verdict: boolean }> | Readonly<{ outcome: "none" }>;

/** What one LLM answer said: a verdict, or none, and the tokens it billed either way. */
type InstantEvalLlmJudgeReading = Verdict & Readonly<{ inputTokens: number; outputTokens: number }>;

const UNREADABLE: InstantEvalLlmJudgeReading = { outcome: "none", inputTokens: 0, outputTokens: 0 };

export function readInstantEvalLlmJudgeAnswer({
  wire,
  body,
}: {
  wire: InstantEvalLlmJudgeWire;
  body: unknown;
}): InstantEvalLlmJudgeReading {
  if (wire === "anthropic_messages") {
    const parsed = anthropicResponseSchema.safeParse(body);
    if (!parsed.success) return UNREADABLE;
    const call = parsed.data.content.find(
      (part) => part.type === "tool_use" && part.name === EVALUATION_TOOL.name,
    );
    return { ...verdictOf(call?.input), ...usageOf(parsed.data.usage) };
  }
  const parsed = openAiResponseSchema.safeParse(body);
  if (!parsed.success) return UNREADABLE;
  const call = parsed.data.output.find(
    (item) => item.type === "function_call" && item.name === EVALUATION_TOOL.name,
  );
  return { ...verdictOf(argumentsOf(call?.arguments)), ...usageOf(parsed.data.usage) };
}

function argumentsOf(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function verdictOf(input: unknown): Verdict {
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success) return { outcome: "none" };
  const { result } = parsed.data;
  return { outcome: "verdict", verdict: typeof result === "boolean" ? result : result === "true" };
}

function usageOf(usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  return { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 };
}
