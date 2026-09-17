import { z } from "zod";

export const evaluatorParamsSchema = z.object({
  evaluator: z
    .string()
    .describe(
      "Which evaluator to run. Either a built-in id (`ragas/faithfulness`), the slug of a monitor configured in this project, or `evaluators/{slug|id}` for a saved evaluator. `GET /api/evaluations/list` returns the built-in ids.",
    ),
});

export const namespacedEvaluatorParamsSchema = z.object({
  evaluator: z.string().describe("First segment of the evaluator id, such as `ragas`"),
  subpath: z.string().describe("Second segment of the evaluator id, such as `faithfulness`"),
});

export const batchEvaluationInputSchema = z.object({
  evaluation: z.string(),
  experimentSlug: z.string().optional(),
  batchId: z.string().optional(),
  datasetSlug: z.string(),
  data: z.looseObject({}).optional().nullable(),
  settings: z.looseObject({}).optional().nullable(),
});

export type BatchEvaluationRESTParams = z.infer<typeof batchEvaluationInputSchema>;
