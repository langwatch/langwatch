/**
 * The batch-evaluation rows and rollups dataset owns as `BatchEvaluation`, beside the
 * datasets they ran against. Experiment serves them as `batchRecord.*`.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * One experiment-and-dataset rollup: how many batch evaluations ran, what they
 * cost, and the mean score. Shaped as the grouped read answers it, so the
 * index page reads the same keys it always has.
 */
const batchEvaluationSummarySchemaDefinition = z.object({
  experimentId: z.string(),
  datasetSlug: z.string(),
  _count: z.object({ experimentId: z.number() }),
  _sum: z.object({ cost: z.number().nullable() }),
  _avg: z.object({ score: z.number().nullable() }),
});
export interface BatchEvaluationSummarySchema extends Named<
  typeof batchEvaluationSummarySchemaDefinition
> {}
export const batchEvaluationSummarySchema: BatchEvaluationSummarySchema =
  batchEvaluationSummarySchemaDefinition;
export type BatchEvaluationSummary = z.infer<typeof batchEvaluationSummarySchema>;

/**
 * One batch-evaluation row with the dataset it ran against. Loose on purpose:
 * the row is the stored one, and the export beside it reads columns this
 * schema names as well as the whole `data` payload it does not.
 */
const batchEvaluationRecordSchemaDefinition = z.looseObject({
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
export interface BatchEvaluationRecordSchema extends Named<
  typeof batchEvaluationRecordSchemaDefinition
> {}
export const batchEvaluationRecordSchema: BatchEvaluationRecordSchema =
  batchEvaluationRecordSchemaDefinition;
export type BatchEvaluationRecord = z.infer<typeof batchEvaluationRecordSchema>;
