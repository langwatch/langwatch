/**
 * The LLM legs' request and answer: one question as a forced `evaluation` tool call, on
 * Anthropic Messages or OpenAI Responses. Yes or no reads the tool's `result`, a score its
 * `score` inside the question's range, a category its `label` among the offered options.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalBooleanQuestion,
  InstantEvalCategoryQuestion,
  InstantEvalJudgeJob,
  InstantEvalQuestion,
  InstantEvalScoreQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

import type { InstantEvalLlmJudgeValue } from "./instant-eval-judge-sureness.rules.ts";

const INSTANT_EVAL_LLM_JUDGE_WIRES = ["anthropic_messages", "openai_responses"] as const;
export type InstantEvalLlmJudgeWire = (typeof INSTANT_EVAL_LLM_JUDGE_WIRES)[number];

const SEARCH_SYSTEM_PROMPT =
  "You are an LLM evaluator answering a yes/no question about a trace or conversation";

/** A score or category asked of a search question or a criterion, not of an evaluator's prompt. */
const GENERIC_SYSTEM_PROMPT =
  "You are an LLM evaluator answering a question about a trace or conversation";

const RESULT_FRAMING = [
  "Answer by calling the `evaluation` function, setting `result` to exactly the true or false",
  "value the instructions above ask you to return. If they say when to return false, return",
  "false in that case and true in every other case. If they say when to return true, return",
  "true in that case and false in every other case. `result` is not a rating of the output,",
  "never invert it.",
].join(" ");

const scoreFraming = ({ min, max }: { min: number; max: number }) =>
  [
    "Answer by calling the `evaluation` function, setting `score` to the number the instructions",
    `above ask for, on their scale from ${min} to ${max}. Use the scale as the instructions`,
    "define it; never invert it.",
  ].join(" ");

const CATEGORY_FRAMING = [
  "Answer by calling the `evaluation` function, setting `label` to exactly one of the category",
  "names listed in the task: the one the instructions above call for.",
].join(" ");

const TOOL_NAME = "evaluation";

const BOOLEAN_TOOL = {
  name: TOOL_NAME,
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

const TYPED_REASONING = {
  type: "string",
  description:
    "A short justification, written before the answer: what the instructions measure, the evidence in the content that settles it (quote the values or name the tool result), and the answer that follows.",
} as const;

type EvaluationTool = Readonly<{
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
}>;

function scoreTool({ min, max }: { min: number; max: number }): EvaluationTool {
  return {
    name: TOOL_NAME,
    description:
      "Record the score the instructions ask for, with a short justification that cites the evidence in the content.",
    parameters: {
      type: "object",
      properties: {
        reasoning: TYPED_REASONING,
        score: {
          type: "number",
          minimum: min,
          maximum: max,
          description: `The score on the instructions' scale, from ${min} to ${max}.`,
        },
      },
      required: ["reasoning", "score"],
    },
  };
}

function categoryTool(question: InstantEvalCategoryQuestion): EvaluationTool {
  return {
    name: TOOL_NAME,
    description:
      "Record the category the instructions ask for, with a short justification that cites the evidence in the content.",
    parameters: {
      type: "object",
      properties: {
        reasoning: TYPED_REASONING,
        label: {
          type: "string",
          enum: question.options.map((option) => option.name),
          description: "Exactly one category name from the list in the task.",
        },
      },
      required: ["reasoning", "label"],
    },
  };
}

const MAX_OUTPUT_TOKENS = 8_000;

/** One LLM leg's messages and the tool it is forced to call. */
interface InstantEvalLlmJudgePrompt {
  readonly system: string;
  readonly user: string;
  readonly tool: EvaluationTool;
}

/**
 * The system and user messages and the tool: an evaluator is asked as itself, a search question
 * or a criterion as a task about the text. Each kind gets its own framing and tool.
 */
export function instantEvalLlmJudgePromptOf({
  job,
  question,
  text,
}: {
  job: InstantEvalJudgeJob;
  question: InstantEvalQuestion;
  text: string;
}): InstantEvalLlmJudgePrompt {
  const isEvaluator = job === "llm_judge";
  const user = (task: string) => `# Input\n${text}\n\n# Task\n${task}`;
  if (question.kind === "boolean") {
    const asked = booleanText(question);
    const system = isEvaluator ? asked : SEARCH_SYSTEM_PROMPT;
    const task = isEvaluator
      ? asked
      : `Answer this question about the text above with true (yes) or false (no): ${asked}`;
    return { system: `${system}\n\n${RESULT_FRAMING}`, user: user(task), tool: BOOLEAN_TOOL };
  }
  const system = isEvaluator ? question.instructions : GENERIC_SYSTEM_PROMPT;
  if (question.kind === "score") {
    const { min, max } = question.range;
    const task = isEvaluator
      ? `${question.instructions}\n\nScore from ${min} to ${max}.`
      : `Answer this question about the text above with a score from ${min} to ${max}: ${question.instructions}`;
    return {
      system: `${system}\n\n${scoreFraming(question.range)}`,
      user: user(task),
      tool: scoreTool(question.range),
    };
  }
  const asked = isEvaluator
    ? question.instructions
    : `Answer this question about the text above with one of the categories below: ${question.instructions}`;
  return {
    system: `${system}\n\n${CATEGORY_FRAMING}`,
    user: user(`${asked}\n\n# Categories\n${categoryList(question)}`),
    tool: categoryTool(question),
  };
}

function booleanText(question: InstantEvalBooleanQuestion): string {
  const { criteria } = question;
  return criteria
    ? `${question.instructions}\nReturn true if: ${criteria[0]}\nReturn false if: ${criteria[1]}`
    : question.instructions;
}

function categoryList(question: InstantEvalCategoryQuestion): string {
  return question.options
    .map(({ name, description }) => (description ? `- ${name}: ${description}` : `- ${name}`))
    .join("\n");
}

export function instantEvalLlmJudgeBodyOf({
  wire,
  model,
  prompt,
}: {
  wire: InstantEvalLlmJudgeWire;
  model: string;
  prompt: InstantEvalLlmJudgePrompt;
}): Record<string, unknown> {
  const { system, user, tool } = prompt;
  if (wire === "anthropic_messages") {
    return {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.parameters }],
      tool_choice: { type: "tool", name: tool.name },
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
    tools: [{ type: "function", ...tool, strict: false }],
    tool_choice: { type: "function", name: tool.name },
  };
}

const resultSchema = z.object({ result: z.union([z.boolean(), z.enum(["true", "false"])]) });
const scoreSchema = z.object({ score: z.union([z.number(), z.string().trim().min(1)]) });
const labelSchema = z.object({ label: z.string() });

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

type Reading =
  | Readonly<{ outcome: "value"; value: InstantEvalLlmJudgeValue }>
  | Readonly<{ outcome: "none" }>;

/** What one LLM answer said: a value, or none, and the tokens it billed either way. */
type InstantEvalLlmJudgeReading = Reading & Readonly<{ inputTokens: number; outputTokens: number }>;

const UNREADABLE: InstantEvalLlmJudgeReading = { outcome: "none", inputTokens: 0, outputTokens: 0 };

export function readInstantEvalLlmJudgeAnswer({
  wire,
  body,
  question,
}: {
  wire: InstantEvalLlmJudgeWire;
  body: unknown;
  question: InstantEvalQuestion;
}): InstantEvalLlmJudgeReading {
  if (wire === "anthropic_messages") {
    const parsed = anthropicResponseSchema.safeParse(body);
    if (!parsed.success) return UNREADABLE;
    const call = parsed.data.content.find(
      (part) => part.type === "tool_use" && part.name === TOOL_NAME,
    );
    return { ...valueOf({ input: call?.input, question }), ...usageOf(parsed.data.usage) };
  }
  const parsed = openAiResponseSchema.safeParse(body);
  if (!parsed.success) return UNREADABLE;
  const call = parsed.data.output.find(
    (item) => item.type === "function_call" && item.name === TOOL_NAME,
  );
  const input = argumentsOf(call?.arguments);
  return { ...valueOf({ input, question }), ...usageOf(parsed.data.usage) };
}

function argumentsOf(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function valueOf({ input, question }: { input: unknown; question: InstantEvalQuestion }): Reading {
  if (question.kind === "boolean") {
    const parsed = resultSchema.safeParse(input);
    if (!parsed.success) return { outcome: "none" };
    const { result } = parsed.data;
    return {
      outcome: "value",
      value: { verdict: typeof result === "boolean" ? result : result === "true" },
    };
  }
  if (question.kind === "score") return scoreValueOf({ input, question });
  return labelValueOf({ input, question });
}

/** A number inside the asked range; anything else is no answer, never a clamped guess. */
function scoreValueOf({
  input,
  question,
}: {
  input: unknown;
  question: InstantEvalScoreQuestion;
}): Reading {
  const parsed = scoreSchema.safeParse(input);
  if (!parsed.success) return { outcome: "none" };
  const score = Number(parsed.data.score);
  const { min, max } = question.range;
  if (!Number.isFinite(score) || score < min || score > max) return { outcome: "none" };
  return { outcome: "value", value: { score } };
}

/** An offered option's name, matched exactly, else ignoring case and surrounding space. */
function labelValueOf({
  input,
  question,
}: {
  input: unknown;
  question: InstantEvalCategoryQuestion;
}): Reading {
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return { outcome: "none" };
  const said = parsed.data.label;
  const names = question.options.map((option) => option.name);
  const loose = said.trim().toLowerCase();
  const label =
    names.find((name) => name === said) ??
    names.find((name) => name.trim().toLowerCase() === loose);
  return label === undefined ? { outcome: "none" } : { outcome: "value", value: { label } };
}

function usageOf(usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  return { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 };
}
