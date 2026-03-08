import { z } from "zod";
import type {
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
} from "./evaluators.generated";
import type { FilterField } from "../filters/types";

export type CheckPreconditionRule =
  | "contains"
  | "not_contains"
  | "matches_regex"
  | "is";

/** All fields that can be used in preconditions: every FilterField plus input/output */
export type CheckPreconditionFields = FilterField | "input" | "output";

export type CheckPrecondition = {
  field: CheckPreconditionFields;
  rule: CheckPreconditionRule;
  /**
   * @minLength 1
   * @maxLength 500
   */
  value: string;
  /** Key for nested filters (e.g., metadata key name for metadata.value) */
  key?: string;
  /** Subkey for double-nested filters (e.g., event detail key) */
  subkey?: string;
};

export type CheckPreconditions = CheckPrecondition[];

export type Conversation = {
  input?: string;
  output?: string;
}[];

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
