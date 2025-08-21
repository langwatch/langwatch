import { z } from "zod";
import type {
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
} from "./evaluators.generated";
import type { batchEvaluationResultSchema, singleEvaluationResultSchema } from "./evaluators.zod.generated";

export type CheckPreconditionFields = "input" | "output" | "metadata.labels";

export type CheckPrecondition =
  | {
      field: CheckPreconditionFields;
      rule: "contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CheckPreconditionFields;
      rule: "not_contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CheckPreconditionFields;
      rule: "matches_regex";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
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

export type SingleEvaluationResult = z.infer<typeof singleEvaluationResultSchema>;
export type BatchEvaluationResult = z.infer<typeof batchEvaluationResultSchema>;

export type EvaluationRESTParams = z.infer<typeof evaluationInputSchema>;
