/**
 * The evaluator input a public evaluate door hands the runtime, as a pure rule
 * both evaluation's evaluate doors and experiment's dataset door read.
 */
import {
  AVAILABLE_EVALUATORS,
  CODE_EVALUATOR_CHECK_PREFIX,
  coerceEvaluatorScalar,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import { extractChunkTextualContent, rAGChunkSchema } from "@langwatch/trace-contract";
import { z } from "zod";

import type { EvaluationDispatchData } from "./evaluation-rest.schemas.ts";

const coercedString = z.preprocess(coerceEvaluatorScalar, z.string().optional().nullable());

const defaultEvaluatorInputSchema = z.object({
  input: coercedString,
  output: coercedString,
  contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  expected_output: coercedString,
  expected_contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  conversation: z
    .array(
      z.object({
        input: coercedString,
        output: coercedString,
      }),
    )
    .optional()
    .nullable(),
});

/** The six canonical fields a built-in evaluator reads its input from. */
const CANONICAL_KEYS: ReadonlySet<string> = new Set([
  "input",
  "output",
  "contexts",
  "expected_output",
  "expected_contexts",
  "conversation",
]);

const parseContexts = (contexts: unknown): string[] | undefined => {
  if (contexts === null || contexts === undefined) return undefined;
  const parsedContexts = Array.isArray(contexts) ? contexts : [contexts];

  return parsedContexts.map((context) => {
    if (typeof context === "string") return context;

    return extractChunkTextualContent("content" in context ? context.content : context);
  });
};

/** A built-in evaluator reads the six canonical fields; a custom or code one its params as sent. */
export const getEvaluatorDataForParams = (
  checkType: string,
  params: Record<string, unknown>,
): EvaluationDispatchData => {
  const declaresOwnInputs =
    checkType.startsWith("custom/") || checkType.startsWith(CODE_EVALUATOR_CHECK_PREFIX);

  if (declaresOwnInputs) return { type: "custom", data: params };

  const data_ = defaultEvaluatorInputSchema.parse({
    ...params,
    contexts: parseContexts(params.contexts),
    expected_contexts: parseContexts(params.expected_contexts),
  });

  // Preserve evaluator-specific fields (e.g. pairwise's candidate_a_id /
  // candidate_a_output) that the legacy default schema strips. Bounded to the
  // evaluator's declared required + optional fields so a stray mapping output
  // on a non-pairwise evaluator can't ride through and trip a strict pydantic
  // model on the langevals side.
  const evaluatorContract = AVAILABLE_EVALUATORS[checkType as EvaluatorTypes];
  const allowedExtras = new Set([
    ...(evaluatorContract?.requiredFields ?? []),
    ...(evaluatorContract?.optionalFields ?? []),
  ]);
  const extras: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (CANONICAL_KEYS.has(key)) continue;
    if (!allowedExtras.has(key)) continue;
    extras[key] = value;
  }

  return {
    type: "default",
    data: {
      ...extras,
      input: data_.input ? data_.input : undefined,
      output: data_.output ? data_.output : undefined,
      contexts: JSON.stringify(data_.contexts),
      expected_output: data_.expected_output ? data_.expected_output : undefined,
      expected_contexts: JSON.stringify(data_.expected_contexts),
      conversation: JSON.stringify(
        data_.conversation?.map((message) => ({
          input: message.input ?? undefined,
          output: message.output ?? undefined,
        })) ?? [],
      ),
    },
  };
};
