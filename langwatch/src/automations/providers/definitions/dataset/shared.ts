import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { SharedDef } from "../../types";

export const datasetMappingSchema = z.object({
  mapping: z.record(z.any()),
  expansions: z.array(z.string()).optional(),
});

export const datasetActionParamsSchema = z.object({
  datasetId: z.string().min(1, "Pick a dataset to append matched traces to."),
  datasetMapping: datasetMappingSchema.optional(),
});

export type DatasetActionParams = z.infer<typeof datasetActionParamsSchema>;

const def: SharedDef = {
  action: TriggerAction.ADD_TO_DATASET,
  category: "action",
  label: "Add to dataset",
  description: "Append matched traces to a dataset for later evaluation.",
  actionParamsSchema: datasetActionParamsSchema,
};

export default def;
