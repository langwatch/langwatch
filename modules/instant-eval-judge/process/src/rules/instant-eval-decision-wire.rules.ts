/**
 * An own decision model's request and answer (ADR-182 decision 8). The Jev body is shared by
 * Inception, Perplexity and Cloudflare; OpenAI's Decisions API takes a list of named questions,
 * which is turned back into the Jev answer shape so one reader serves every wire.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import {
  classifierResponseSchema,
  toClassifierQuestions,
  type InstantEvalDecisionWire,
  type InstantEvalQuestion,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

type ClassifierResponse = z.infer<typeof classifierResponseSchema>;

export function decisionRequestBodyOf({
  wire,
  providerModel,
  text,
  questions,
}: {
  wire: InstantEvalDecisionWire;
  providerModel: string;
  text: string;
  questions: readonly InstantEvalQuestion[];
}): Record<string, unknown> {
  if (wire !== "openai_decisions") {
    return { model: providerModel, state: text, questions: toClassifierQuestions(questions) };
  }
  return {
    model: providerModel,
    input: text,
    questions: questions.map(toOpenAiDecisionQuestion),
  };
}

function toOpenAiDecisionQuestion(question: InstantEvalQuestion): Record<string, unknown> {
  if (question.kind === "boolean") {
    const { criteria } = question;
    const instructions = criteria
      ? `${question.instructions}\nTrue when: ${criteria[0]}\nFalse when: ${criteria[1]}`
      : question.instructions;
    return { type: "predicate", name: question.id, instructions };
  }
  if (question.kind === "score") {
    const { min, max } = question.range;
    const levels = Array.from({ length: max - min + 1 }, (_, index) => ({
      label: String(min + index),
    }));
    return { type: "score", name: question.id, instructions: question.instructions, levels };
  }
  return {
    type: "choice",
    name: question.id,
    instructions: question.instructions,
    choices: question.options.map((option) => ({
      value: option.name,
      description: option.description,
    })),
  };
}

const openAiProbabilitySchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  probability: z.number(),
});

const openAiDecisionResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.array(
    z.object({
      type: z.string(),
      name: z.string().optional(),
      probability: z.number().optional(),
      choice: z.union([z.string(), z.number(), z.boolean()]).optional(),
      score: z.number().optional(),
      confidence: z.number().optional(),
      probabilities: z.array(openAiProbabilitySchema).optional(),
    }),
  ),
  usage: z.object({ input_tokens: z.number().optional() }).optional(),
});

/** The answer as the Jev reader takes it, or undefined when it is not the provider's shape. */
export function decisionResponseOf({
  wire,
  body,
}: {
  wire: InstantEvalDecisionWire;
  body: unknown;
}): ClassifierResponse | undefined {
  if (wire === "openai_decisions") return fromOpenAiDecision(body);
  const unwrapped =
    wire === "cloudflare_jev" && isRecord(body) && isRecord(body.result) ? body.result : body;
  const parsed = classifierResponseSchema.safeParse(unwrapped);
  return parsed.success ? parsed.data : undefined;
}

function fromOpenAiDecision(body: unknown): ClassifierResponse | undefined {
  const parsed = openAiDecisionResponseSchema.safeParse(body);
  if (!parsed.success) return undefined;

  const answers: ClassifierResponse["answers"] = {};
  for (const answer of parsed.data.answers) {
    if (!answer.name || answer.type === "refusal") continue;
    const probabilities = answer.probabilities
      ? Object.fromEntries(answer.probabilities.map((p) => [String(p.value), p.probability]))
      : undefined;
    answers[answer.name] = {
      type: answer.type,
      ...(answer.probability === undefined ? {} : { noul: answer.probability }),
      ...(answer.choice === undefined ? {} : { choice: String(answer.choice) }),
      ...(answer.score === undefined ? {} : { score: answer.score }),
      ...(probabilities ? { probabilities } : {}),
      ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
    };
  }
  const inputTokens = parsed.data.usage?.input_tokens;
  return {
    ...(parsed.data.model ? { model: parsed.data.model } : {}),
    answers,
    ...(inputTokens === undefined ? {} : { usage: { input_tokens: inputTokens } }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What one failed send means (ADR-182 decision 9): a refused key is never retried, a rate limit
 * or an outage is retried, and anything else is the request's own fault.
 */
export type DecisionFailure =
  | Readonly<{ kind: "final"; reason: InstantEvalSkipReason }>
  | Readonly<{ kind: "retry"; reason: InstantEvalSkipReason }>;

export function decisionFailureOf({ status }: { status: number }): DecisionFailure {
  if (status === 401 || status === 403) return { kind: "final", reason: "classifier_key_invalid" };
  if (status === 402) return { kind: "final", reason: "classifier_key_invalid" };
  if (status === 413) return { kind: "final", reason: "classifier_input_too_large" };
  if (status === 429) return { kind: "retry", reason: "classifier_rate_limited" };
  if (status >= 500) return { kind: "retry", reason: "classifier_provider_unavailable" };
  return { kind: "final", reason: "classifier_failed" };
}
