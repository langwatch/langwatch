import { resolveRequestBound } from "@langwatch/plans";
/** Dataset tRPC inputs stated once in the contract. Upsert uses two parsers
 * (not intersected) so authorization sweep can read scope ids.
 */
import { z } from "zod";

import {
  datasetRecordFormSchema,
  datasetRecordInputSchema,
  newDatasetEntriesSchema,
} from "./dataset.ts";
import type { Dataset, DatasetNameResult, DatasetSummary } from "./dataset.ts";

/**
 * The outer validation shell is the registry's enterprise ceiling; the
 * application refuses batches above the caller's tier value through the
 * entitlement peer.
 */
const DATASET_RECORD_IDS_MAX = resolveRequestBound("datasetBatchMax", "ENTERPRISE");

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
  z.object({
    ...datasetRecordFormSchema.shape,
    datasetId: z.string().optional(),
  }),
  z.object({
    ...datasetRecordFormSchema.omit({ name: true }).shape,
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

/** `datasetRecord.create`: new entries appended to a dataset. */
export const datasetRecordApiCreateInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  ...newDatasetEntriesSchema.shape,
});

/** `datasetRecord.update`: one entry replaced, or created, by id. */
export const datasetRecordApiUpdateInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  recordId: z.string(),
  updatedRecord: z.record(z.string(), z.any()),
});

/** One dataset inside one project: what the whole-dataset reads name. */
export const datasetRecordApiLookupInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
});

/** `datasetRecord.listPaginated`: the editor's classic page N of M. */
export const datasetRecordApiPageInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(200).default(50),
  search: z.string().optional(),
});

/** `datasetRecord.deleteMany`: entries removed by id. */
export const datasetRecordApiDeleteManyInputSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  recordIds: z.array(z.string()).max(DATASET_RECORD_IDS_MAX),
});

/** `batchRecord.getAllByexperimentSlug`: one experiment, named by its URL slug. */
export const batchRecordApiExperimentSlugInputSchema = z.object({
  projectId: z.string(),
  experimentSlug: z.string(),
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

/**
 * The whole `upsert` payload, as one type: the router chains the two
 * parsers above, so a client's send is their intersection. The split
 * exists for the authorization sweep's benefit; callers needn't know it.
 */
export type DatasetApiUpsertInput = DatasetApiUpsertBaseInput & DatasetApiUpsertTargetInput;

/** Studio read/write outputs. Two (getAll, getById) are the transport's
 * shape: getAll excludes pagination, getById answers null instead of throwing.
 */
export type DatasetApiGetAllOutput = DatasetSummary[];
export type DatasetApiGetByIdOutput = Dataset | null;
export type DatasetApiUpsertOutput = Dataset;
export type DatasetApiValidateNameOutput = DatasetNameResult;

/** The next free name itself — the copy dialog puts it straight in the field. */
export type DatasetApiFindNextNameOutput = string;
