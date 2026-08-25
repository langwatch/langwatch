import { z } from "zod";
import type { SharedDef } from "../provider-types";

export const traceMappingEntrySchema = z.object({
  source: z.string(),
  key: z.string().optional(),
  subkey: z.string().optional(),
  selectedFields: z.array(z.string()).optional(),
});
export const datasetMappingSchema = z.object({
  mapping: z.record(z.string(), traceMappingEntrySchema),
  expansions: z.array(z.string()).default([]),
});
export const datasetActionParamsSchema = z.object({
  datasetId: z.string().min(1, "Pick a dataset to append matched traces to."),
  datasetMapping: datasetMappingSchema,
});
export type DatasetActionParams = z.infer<typeof datasetActionParamsSchema>;

const definition: SharedDef = {
  action: "ADD_TO_DATASET",
  category: "action",
  label: "Add to dataset",
  description: "Append matched traces to a dataset for later evaluation.",
  actionParamsSchema: datasetActionParamsSchema,
};

export default definition;
