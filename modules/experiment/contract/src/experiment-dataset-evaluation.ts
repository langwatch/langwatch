/**
 * One SDK dataset evaluation: what the door hands experiment, and the outcome
 * it answers. Each refusal is named so the door writes main's body for it.
 * @see modules/experiment/specs/experiment-dataset-evaluation.feature
 */
import { singleEvaluationResultSchema } from "@langwatch/evaluator-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

const datasetEvaluationInputSchemaDefinition = z.object({
  projectId: z.string(),
  /** The evaluator, as a monitor slug or an evaluator type. */
  evaluation: z.string(),
  datasetSlug: z.string(),
  /** Groups the results; a generated slug, which no experiment holds, when absent. */
  experimentSlug: z.string().optional(),
  /** The entry the evaluator scores. */
  data: z.record(z.string(), z.unknown()),
});
export interface DatasetEvaluationInputSchema extends Named<
  typeof datasetEvaluationInputSchemaDefinition
> {}
export const datasetEvaluationInputSchema: DatasetEvaluationInputSchema =
  datasetEvaluationInputSchemaDefinition;

export type DatasetEvaluationInput = z.infer<typeof datasetEvaluationInputSchema>;

const datasetEvaluationOutcomeSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("evaluated"), result: singleEvaluationResultSchema }),
  z.object({ outcome: z.literal("evaluator_not_found"), checkType: z.string() }),
  z.object({
    outcome: z.literal("missing_field"),
    checkType: z.string(),
    requiredFields: z.array(z.string()),
  }),
  z.object({ outcome: z.literal("invalid_data"), sentence: z.string() }),
  z.object({ outcome: z.literal("dataset_not_found") }),
]);
export interface DatasetEvaluationOutcomeSchema extends Named<
  typeof datasetEvaluationOutcomeSchemaDefinition
> {}
export const datasetEvaluationOutcomeSchema: DatasetEvaluationOutcomeSchema =
  datasetEvaluationOutcomeSchemaDefinition;

export type DatasetEvaluationOutcome = z.infer<typeof datasetEvaluationOutcomeSchema>;
