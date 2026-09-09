/**
 * Every `batchRecord.*` procedure, declared once: the two rollups an
 * experiment's batch-evaluation runs are summarised by. The rows are
 * `BatchEvaluation`, which this feature owns beside the datasets they ran
 * against.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  batchRecordApiExperimentSlugInputSchema,
  datasetApiProjectInputSchema,
} from "./dataset.schemas.ts";

/**
 * One experiment-and-dataset rollup: how many batch evaluations ran, what they
 * cost, and the mean score. Shaped as the grouped read answers it, so the
 * index page reads the same keys it always has.
 */
export const batchEvaluationSummarySchema = z.object({
  experimentId: z.string(),
  datasetSlug: z.string(),
  _count: z.object({ experimentId: z.number() }),
  _sum: z.object({ cost: z.number().nullable() }),
  _avg: z.object({ score: z.number().nullable() }),
});
export type BatchEvaluationSummary = z.infer<typeof batchEvaluationSummarySchema>;

/**
 * One batch-evaluation row with the dataset it ran against. Loose on purpose:
 * the row is the stored one, and the export beside it reads columns this
 * schema names as well as the whole `data` payload it does not.
 */
export const batchEvaluationRecordSchema = z.looseObject({
  id: z.string(),
  experimentId: z.string(),
  projectId: z.string(),
  data: z.unknown(),
  status: z.string(),
  score: z.number(),
  label: z.string().nullable(),
  passed: z.boolean(),
  details: z.string(),
  cost: z.number(),
  datasetSlug: z.string(),
  datasetId: z.string(),
  evaluation: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  dataset: z.looseObject({ id: z.string(), name: z.string(), slug: z.string() }),
});
export type BatchEvaluationRecord = z.infer<typeof batchEvaluationRecordSchema>;

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
