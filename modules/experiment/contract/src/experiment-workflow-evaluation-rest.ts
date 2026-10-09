/**
 * What `POST /api/workflows/:id/evaluate` takes and answers, as workflow
 * published it before experiment served the door.
 */
import { z } from "zod";

/** The workflow the evaluate door runs. */
export const experimentWorkflowEvaluateParamsSchema = z.object({ id: z.string().min(1) });

/** One evaluation run started, in the snake-cased names the workflow evaluate door publishes. */
export const experimentWorkflowEvaluationStartedSchema = z.object({
  run_id: z.string(),
  run_url: z.string(),
  workflow_version_id: z.string(),
  version: z.string(),
});

/** What a caller may ask an evaluation run to cover. */
export const experimentWorkflowEvaluateSchema = z
  .object({
    version_id: z
      .string()
      .optional()
      .describe("Committed version to evaluate; defaults to the latest commit"),
    data: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Inline rows to evaluate instead of the workflow's attached dataset"),
    dataset_id: z
      .string()
      .optional()
      .describe("Platform dataset id to evaluate; mutually exclusive with data"),
    parameters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Constant entry inputs applied to every row, e.g. a feature flag or PR number"),
    row_indices: z
      .array(z.number().int().nonnegative())
      .optional()
      .describe("Subset of dataset row indices to evaluate"),
  })
  .refine((body) => !(body.data && body.dataset_id), {
    message: "Pass either data or a dataset_id, not both",
    path: ["data"],
  });
