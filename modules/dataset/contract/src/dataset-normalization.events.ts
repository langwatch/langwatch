import { z } from "zod";

import { datasetStatusSchema } from "./dataset.ts";

/** A dataset's normalisation came to rest, ready or failed; reads of the dataset refresh on it. */
export const DATASET_NORMALIZATION_SETTLED_EVENT_TYPE = "lw.dataset.normalization_settled" as const;
export const DATASET_NORMALIZATION_EVENT_VERSION = "2026-10-10" as const;

export const datasetNormalizationSettledEventDataSchema = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  status: datasetStatusSchema.extract(["ready", "failed"]),
});
export type DatasetNormalizationSettledEventData = z.infer<
  typeof datasetNormalizationSettledEventDataSchema
>;
