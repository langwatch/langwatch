/**
 * Every `batchRecord.*` procedure, declared once: the two rollups an experiment's
 * batch-evaluation runs are summarised by. Experiment serves the namespace, names
 * unchanged; the rows stay dataset's `BatchEvaluation` (Alex, 2026-10-07, round 9 D2).
 */
import {
  batchEvaluationRecordSchema,
  batchEvaluationSummarySchema,
  datasetApiProjectInputSchema,
} from "@langwatch/dataset-contract";
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

/** `batchRecord.getAllByexperimentSlug`: one experiment, named by its URL slug. */
const batchRecordApiExperimentSlugInputSchemaDefinition = z.object({
  projectId: z.string(),
  experimentSlug: z.string(),
});
export interface BatchRecordApiExperimentSlugInputSchema extends Named<
  typeof batchRecordApiExperimentSlugInputSchemaDefinition
> {}
export const batchRecordApiExperimentSlugInputSchema: BatchRecordApiExperimentSlugInputSchema =
  batchRecordApiExperimentSlugInputSchemaDefinition;

export const batchRecordTrpc = defineTrpcContract("batchRecord")
  /** One row per experiment and dataset, for the batch-evaluations index. */
  .query("getAllByexperimentIdGroup")
  .withInput(datasetApiProjectInputSchema)
  .withOutput(z.array(batchEvaluationSummarySchema))

  /** Every batch-evaluation record of one experiment, named by its slug. */
  .query("getAllByexperimentSlug")
  .withInput(batchRecordApiExperimentSlugInputSchema)
  .withOutput(z.array(batchEvaluationRecordSchema))
  .build();
