import { checkPreconditionsSchema } from "@langwatch/trace-contract";
import { z } from "zod";

import {
  evaluatorsSchema,
  type EvaluationResult,
  type EvaluationResultError,
  type EvaluationResultSkipped,
} from "./evaluators.generated.ts";

/** Main's `traces.getSampleTraces` check: a generated catalogue evaluator or a custom one. */
export const preconditionMatchInputSchema = z.object({
  evaluatorType: evaluatorsSchema.keyof().or(z.string().startsWith("custom/")),
  preconditions: checkPreconditionsSchema,
});

export const conversationSchema = z.array(
  z.object({
    input: z.string().optional(),
    output: z.string().optional(),
  }),
);

export type Conversation = z.infer<typeof conversationSchema>;

export const evaluationInputSchema = z.object({
  trace_id: z.string().optional().nullable(),
  evaluation_id: z.string().optional().nullable(),
  evaluator_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  data: z.object({}).passthrough().optional().nullable(),
  settings: z.object({}).passthrough().optional().nullable(),
  as_guardrail: z.boolean().optional().nullable().default(false),
});

export type EvaluationRESTParams = z.infer<typeof evaluationInputSchema>;

export type EvaluationRESTResult = (
  | EvaluationResult
  | EvaluationResultSkipped
  | Omit<EvaluationResultError, "traceback">
) & {
  passed?: boolean;
};
