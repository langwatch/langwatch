import type { Named } from "@langwatch/module";
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
import type { DatasetNameResult, DatasetSummaryWire, DatasetWire } from "./dataset.ts";

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
const datasetApiUpsertBaseInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetRecords: z.array(datasetRecordInputSchema).optional(),
});
export interface DatasetApiUpsertBaseInputSchema extends Named<
  typeof datasetApiUpsertBaseInputSchemaDefinition
> {}
export const datasetApiUpsertBaseInputSchema: DatasetApiUpsertBaseInputSchema =
  datasetApiUpsertBaseInputSchemaDefinition;

/**
 * The half that names the dataset: every caller names it outright (Alex,
 * 2026-10-07, round 9 D3; the experiment-name borrow is gone).
 */
const datasetApiUpsertTargetInputSchemaDefinition = z.object({
  ...datasetRecordFormSchema.shape,
  datasetId: z.string().optional(),
});
export interface DatasetApiUpsertTargetInputSchema extends Named<
  typeof datasetApiUpsertTargetInputSchemaDefinition
> {}
export const datasetApiUpsertTargetInputSchema: DatasetApiUpsertTargetInputSchema =
  datasetApiUpsertTargetInputSchemaDefinition;

const datasetApiValidateNameInputSchemaDefinition = z.object({
  projectId: z.string(),
  proposedName: z.string(),
  excludeDatasetId: z.string().optional(),
});
export interface DatasetApiValidateNameInputSchema extends Named<
  typeof datasetApiValidateNameInputSchemaDefinition
> {}
export const datasetApiValidateNameInputSchema: DatasetApiValidateNameInputSchema =
  datasetApiValidateNameInputSchemaDefinition;

/** One project. The list read names it and nothing else. */
const datasetApiProjectInputSchemaDefinition = z.object({ projectId: z.string() });
export interface DatasetApiProjectInputSchema extends Named<
  typeof datasetApiProjectInputSchemaDefinition
> {}
export const datasetApiProjectInputSchema: DatasetApiProjectInputSchema =
  datasetApiProjectInputSchemaDefinition;

/** One dataset inside one project, by id or by slug. */
const datasetApiDatasetInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetId: z.string(),
});
export interface DatasetApiDatasetInputSchema extends Named<
  typeof datasetApiDatasetInputSchemaDefinition
> {}
export const datasetApiDatasetInputSchema: DatasetApiDatasetInputSchema =
  datasetApiDatasetInputSchemaDefinition;

const datasetApiDeleteInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  undo: z.boolean().optional(),
});
export interface DatasetApiDeleteInputSchema extends Named<
  typeof datasetApiDeleteInputSchemaDefinition
> {}
export const datasetApiDeleteInputSchema: DatasetApiDeleteInputSchema =
  datasetApiDeleteInputSchemaDefinition;

const datasetApiUpdateMappingInputSchemaDefinition = z.object({
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
export interface DatasetApiUpdateMappingInputSchema extends Named<
  typeof datasetApiUpdateMappingInputSchemaDefinition
> {}
export const datasetApiUpdateMappingInputSchema: DatasetApiUpdateMappingInputSchema =
  datasetApiUpdateMappingInputSchemaDefinition;

const datasetApiFindNextNameInputSchemaDefinition = z.object({
  projectId: z.string(),
  proposedName: z.string(),
});
export interface DatasetApiFindNextNameInputSchema extends Named<
  typeof datasetApiFindNextNameInputSchemaDefinition
> {}
export const datasetApiFindNextNameInputSchema: DatasetApiFindNextNameInputSchema =
  datasetApiFindNextNameInputSchemaDefinition;

const datasetApiCopyInputSchemaDefinition = z.object({
  datasetId: z.string(),
  sourceProjectId: z.string(),
  projectId: z.string(),
});
export interface DatasetApiCopyInputSchema extends Named<
  typeof datasetApiCopyInputSchemaDefinition
> {}
export const datasetApiCopyInputSchema: DatasetApiCopyInputSchema =
  datasetApiCopyInputSchemaDefinition;

/** `datasetRecord.create`: new entries appended to a dataset. */
const datasetRecordApiCreateInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  ...newDatasetEntriesSchema.shape,
});
export interface DatasetRecordApiCreateInputSchema extends Named<
  typeof datasetRecordApiCreateInputSchemaDefinition
> {}
export const datasetRecordApiCreateInputSchema: DatasetRecordApiCreateInputSchema =
  datasetRecordApiCreateInputSchemaDefinition;

/** `datasetRecord.update`: one entry replaced, or created, by id. */
const datasetRecordApiUpdateInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  recordId: z.string(),
  updatedRecord: z.record(z.string(), z.any()),
});
export interface DatasetRecordApiUpdateInputSchema extends Named<
  typeof datasetRecordApiUpdateInputSchemaDefinition
> {}
export const datasetRecordApiUpdateInputSchema: DatasetRecordApiUpdateInputSchema =
  datasetRecordApiUpdateInputSchemaDefinition;

/** One dataset inside one project: what the whole-dataset reads name. */
const datasetRecordApiLookupInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetId: z.string(),
});
export interface DatasetRecordApiLookupInputSchema extends Named<
  typeof datasetRecordApiLookupInputSchemaDefinition
> {}
export const datasetRecordApiLookupInputSchema: DatasetRecordApiLookupInputSchema =
  datasetRecordApiLookupInputSchemaDefinition;

/** `datasetRecord.listPaginated`: the editor's classic page N of M. */
const datasetRecordApiPageInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(200).default(50),
  search: z.string().optional(),
});
export interface DatasetRecordApiPageInputSchema extends Named<
  typeof datasetRecordApiPageInputSchemaDefinition
> {}
export const datasetRecordApiPageInputSchema: DatasetRecordApiPageInputSchema =
  datasetRecordApiPageInputSchemaDefinition;

/** `datasetRecord.deleteMany`: entries removed by id. */
const datasetRecordApiDeleteManyInputSchemaDefinition = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  recordIds: z.array(z.string()).max(DATASET_RECORD_IDS_MAX),
});
export interface DatasetRecordApiDeleteManyInputSchema extends Named<
  typeof datasetRecordApiDeleteManyInputSchemaDefinition
> {}
export const datasetRecordApiDeleteManyInputSchema: DatasetRecordApiDeleteManyInputSchema =
  datasetRecordApiDeleteManyInputSchemaDefinition;

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
export type DatasetApiGetAllOutput = DatasetSummaryWire[];
export type DatasetApiGetByIdOutput = DatasetWire | null;
export type DatasetApiUpsertOutput = DatasetWire;
export type DatasetApiValidateNameOutput = DatasetNameResult;

/** The next free name itself — the copy dialog puts it straight in the field. */
export type DatasetApiFindNextNameOutput = string;
