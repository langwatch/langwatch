import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { SharedDef } from "../provider-types.ts";

const traceMappingEntrySchemaDefinition = z.object({
  source: z.string(),
  key: z.string().optional(),
  subkey: z.string().optional(),
  selectedFields: z.array(z.string()).optional(),
});
export interface TraceMappingEntrySchema extends Named<typeof traceMappingEntrySchemaDefinition> {}
export const traceMappingEntrySchema: TraceMappingEntrySchema = traceMappingEntrySchemaDefinition;
const datasetMappingSchemaDefinition = z.object({
  mapping: z.record(z.string(), traceMappingEntrySchema),
  expansions: z.array(z.string()).default([]),
});
export interface DatasetMappingSchema extends Named<typeof datasetMappingSchemaDefinition> {}
export const datasetMappingSchema: DatasetMappingSchema = datasetMappingSchemaDefinition;
const datasetActionParamsSchemaDefinition = z.object({
  datasetId: z.string().min(1, "Pick a dataset to append matched traces to."),
  datasetMapping: datasetMappingSchema,
});
export interface DatasetActionParamsSchema extends Named<
  typeof datasetActionParamsSchemaDefinition
> {}
export const datasetActionParamsSchema: DatasetActionParamsSchema =
  datasetActionParamsSchemaDefinition;
export type DatasetActionParams = z.infer<typeof datasetActionParamsSchema>;

const definition: SharedDef = {
  action: "ADD_TO_DATASET",
  category: "action",
  label: "Add to dataset",
  description: "Append matched traces to a dataset for later evaluation.",
  actionParamsSchema: datasetActionParamsSchema,
};

export default definition;
