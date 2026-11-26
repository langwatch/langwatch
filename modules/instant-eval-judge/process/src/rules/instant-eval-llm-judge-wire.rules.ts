/**
 * The LLM legs' request and answer: one question as a forced `evaluation` tool call, on each LLM
 * wire. Yes or no reads the tool's `result`, a score its `score` inside the question's range, a
 * category its `label` among the offered options.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalBooleanQuestion,
  InstantEvalCategoryQuestion,
  InstantEvalJudgeJob,
  InstantEvalJudgeLlmKind,
  InstantEvalJudgeReasoningEffort,
  InstantEvalQuestion,
  InstantEvalScenarioJudgeTool,
  InstantEvalScoreQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

import type { InstantEvalLlmJudgeValue } from "./instant-eval-judge-sureness.rules.ts";
import {
  instantEvalLlmToolCallBodyOf,
  readInstantEvalLlmToolCall,
} from "./instant-eval-llm-tool-call-wire.rules.ts";

/** An LLM leg's wire is its backend kind. */
export type InstantEvalLlmJudgeWire = InstantEvalJudgeLlmKind;

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

/**
 * The leaf may ask a judge's own range on another scale (0 to 1 is asked 1 to 10), so the
 * framing names the asked scale and maps the prompt's onto it rather than trusting "their scale".
 */
const scoreFraming = ({ min, max }: { min: number; max: number }) =>
  [
    "Answer by calling the `evaluation` function, setting `score` to the number the instructions",
    `above ask for, on a scale from ${min} (the lowest they allow) to ${max} (the highest). If`,
    "they state another scale, map it linearly onto this one; never invert it.",
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

type EvaluationTool = InstantEvalScenarioJudgeTool;

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

/**
 * The request body: the tool-call wire's, with the one tool forced. A reasoning effort goes on
 * OpenAI Responses alone, only when the backend sets one, with a reasoning-sized output cap.
 */
export function instantEvalLlmJudgeBodyOf({
  wire,
  model,
  prompt,
  reasoningEffort,
  maxOutputTokens,
}: {
  wire: InstantEvalLlmJudgeWire;
  model: string;
  prompt: InstantEvalLlmJudgePrompt;
  reasoningEffort?: InstantEvalJudgeReasoningEffort;
  maxOutputTokens?: number;
}): Record<string, unknown> {
  const { system, user, tool } = prompt;
  return instantEvalLlmToolCallBodyOf({
    wire,
    model,
    prompt: { system, user, tools: [tool], forcedTool: tool.name },
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });
}

const resultSchema = z.object({ result: z.union([z.boolean(), z.enum(["true", "false"])]) });
const scoreSchema = z.object({ score: z.union([z.number(), z.string().trim().min(1)]) });
const labelSchema = z.object({ label: z.string() });

type Reading =
  | Readonly<{ outcome: "value"; value: InstantEvalLlmJudgeValue }>
  | Readonly<{ outcome: "none"; stoppedBy?: string }>;

/**
 * What one LLM answer said: a value, or none, and the tokens it billed either way. An OpenAI
 * answer the provider marked incomplete names why in `stoppedBy` (e.g. `max_output_tokens`).
 */
type InstantEvalLlmJudgeReading = Reading & Readonly<{ inputTokens: number; outputTokens: number }>;

/** The tool-call wire's reading of the `evaluation` call, then its value for the question. */
export function readInstantEvalLlmJudgeAnswer({
  wire,
  body,
  question,
}: {
  wire: InstantEvalLlmJudgeWire;
  body: unknown;
  question: InstantEvalQuestion;
}): InstantEvalLlmJudgeReading {
  const reading = readInstantEvalLlmToolCall({ wire, body, tools: [TOOL_NAME] });
  const { inputTokens, outputTokens } = reading;
  const input = reading.outcome === "called" ? reading.input : undefined;
  const value = valueOf({ input, question });
  const stoppedBy =
    value.outcome === "none" && reading.outcome === "none" ? reading.stoppedBy : undefined;
  return { ...value, ...(stoppedBy ? { stoppedBy } : {}), inputTokens, outputTokens };
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
