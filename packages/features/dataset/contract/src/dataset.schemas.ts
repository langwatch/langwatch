/**
 * The inputs the `dataset.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * `upsert` is two parsers rather than one intersected schema. A `ZodIntersection`
 * exposes no `.shape`, so the authorization declaration sweep cannot read the
 * scope ids out of it and has to treat the procedure as opaque. Chaining the
 * two `.input()` calls keeps the same accepted shape while leaving `projectId`
 * visible to the sweep.
 */
import { z } from "zod";
import { datasetRecordFormSchema, datasetRecordInputSchema } from "./dataset";

/**
 * The half of a dataset write that is the same either way: the tenant key and
 * the rows, if any came with it.
 */
export const datasetApiUpsertBaseInputSchema = z.object({
  projectId: z.string(),
  datasetRecords: z.array(datasetRecordInputSchema).optional(),
});

/**
 * The half that names the dataset. The editor names it outright; the
 * experiment pages name an experiment and borrow its name.
 */
export const datasetApiUpsertTargetInputSchema = z.union([
  datasetRecordFormSchema.extend({
    datasetId: z.string().optional(),
  }),
  datasetRecordFormSchema
    .omit({
      name: true,
    })
    .extend({
      experimentId: z.string(),
    }),
]);

export const datasetApiValidateNameInputSchema = z.object({
  projectId: z.string(),
  proposedName: z.string(),
  excludeDatasetId: z.string().optional(),
});

/** One project. The list read names it and nothing else. */
export const datasetApiProjectInputSchema = z.object({ projectId: z.string() });

/** One dataset inside one project, by id or by slug. */
export const datasetApiDatasetInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
});

export const datasetApiDeleteInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  undo: z.boolean().optional(),
});

export const datasetApiUpdateMappingInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  mapping: z
    .object({
      mapping: z.record(z.string(), z.any()),
      expansions: z.array(z.string()),
    })
    .optional(),
  threadMapping: z
    .object({
      mapping: z.record(z.string(), z.any()),
    })
    .optional(),
});

export const datasetApiFindNextNameInputSchema = z.object({
  projectId: z.string(),
  proposedName: z.string(),
});

export const datasetApiCopyInputSchema = z.object({
  datasetId: z.string(),
  sourceProjectId: z.string(),
  projectId: z.string(),
});

export type DatasetApiUpsertBaseInput = z.infer<typeof datasetApiUpsertBaseInputSchema>;
export type DatasetApiUpsertTargetInput = z.infer<typeof datasetApiUpsertTargetInputSchema>;
export type DatasetApiValidateNameInput = z.infer<typeof datasetApiValidateNameInputSchema>;
export type DatasetApiProjectInput = z.infer<typeof datasetApiProjectInputSchema>;
export type DatasetApiDatasetInput = z.infer<typeof datasetApiDatasetInputSchema>;
export type DatasetApiDeleteInput = z.infer<typeof datasetApiDeleteInputSchema>;
export type DatasetApiUpdateMappingInput = z.infer<typeof datasetApiUpdateMappingInputSchema>;
export type DatasetApiFindNextNameInput = z.infer<typeof datasetApiFindNextNameInputSchema>;
export type DatasetApiCopyInput = z.infer<typeof datasetApiCopyInputSchema>;
