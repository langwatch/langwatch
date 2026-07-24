import { z } from "zod";
import type {
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
} from "./evaluators.generated";
import { filterFieldsEnum } from "../filters/types";

// ---------------------------------------------------------------------------
// Precondition schemas (Zod-first, types inferred)
// ---------------------------------------------------------------------------

export const checkPreconditionRuleSchema = z.enum([
  "contains",
  "not_contains",
  "matches_regex",
  "is",
]);

export type CheckPreconditionRule = z.infer<typeof checkPreconditionRuleSchema>;

/** All fields usable in preconditions: every FilterField plus input/output */
export const checkPreconditionFieldsSchema = z.union([
  filterFieldsEnum,
  z.literal("input"),
  z.literal("output"),
]);

export type CheckPreconditionFields = z.infer<
  typeof checkPreconditionFieldsSchema
>;

export const checkPreconditionSchema = z.object({
  field: checkPreconditionFieldsSchema,
  rule: checkPreconditionRuleSchema,
  value: z.string().min(1).max(500),
  /** Key for nested filters (e.g., metadata key name for metadata.value) */
  key: z.string().optional(),
  /** Subkey for double-nested filters (e.g., event detail key) */
  subkey: z.string().optional(),
});

export type CheckPrecondition = z.infer<typeof checkPreconditionSchema>;

export const checkPreconditionsSchema = z.array(checkPreconditionSchema);

export type CheckPreconditions = z.infer<typeof checkPreconditionsSchema>;

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
