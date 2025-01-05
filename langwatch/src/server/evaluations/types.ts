import { z } from "zod";
import { rAGChunkSchema } from "../tracer/types.generated";
import type {
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
} from "./evaluators.generated";

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
    }
  | {
      field: CheckPreconditionFields;
      rule: "is_similar_to";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
      embeddings?: { model: string; embeddings: number[] };
      threshold: number;
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
  data: z.object({
    input: z.string().optional().nullable(),
    output: z.string().optional().nullable(),
    contexts: z
      .union([z.array(rAGChunkSchema), z.array(z.string())])
      .optional()
      .nullable(),
    expected_output: z.string().optional().nullable(),
    expected_contexts: z
      .union([z.array(rAGChunkSchema), z.array(z.string())])
      .optional()
      .nullable(),
    conversation: z
      .array(
        z.object({
          input: z.string().optional().nullable(),
          output: z.string().optional().nullable(),
        })
      )
      .optional()
      .nullable(),
  }),
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
