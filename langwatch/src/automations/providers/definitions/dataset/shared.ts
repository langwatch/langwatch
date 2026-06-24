import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { SharedDef } from "../../types";

/** One dataset column's source in the trace. Mirrors the `TraceMapping`
 *  record value the dispatcher feeds to `mapTraceToDatasetEntry`: `source`
 *  names a `TRACE_MAPPINGS` key (or "" for unmapped), `key`/`subkey` drill
 *  into keyed sources (metadata field, span subkey), and `selectedFields`
 *  scopes object sources. Kept in sync with that shape so the dispatcher's
 *  `as TraceMapping` cast is sound. */
export const traceMappingEntrySchema = z.object({
  source: z.string(),
  key: z.string().optional(),
  subkey: z.string().optional(),
  selectedFields: z.array(z.string()).optional(),
});

export const datasetMappingSchema = z.object({
  mapping: z.record(traceMappingEntrySchema),
  // The dispatcher reads `expansions` unconditionally; default to an empty
  // list so a producer that omits it never trips the array access.
  expansions: z.array(z.string()).default([]),
});

export const datasetActionParamsSchema = z.object({
  datasetId: z.string().min(1, "Pick a dataset to append matched traces to."),
  // Required: the client's `toActionParams` always derives a non-empty
  // mapping from the selected dataset's columns, so an authored ADD_TO_DATASET
  // trigger never persists without one.
  datasetMapping: datasetMappingSchema,
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
