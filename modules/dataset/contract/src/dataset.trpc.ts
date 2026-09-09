/**
 * Every `dataset.*` procedure, declared once: its name, its kind, what it takes
 * and what it answers. The server binds a permission and a handler to a name
 * declared here; the browser reads the same names and schemas as types.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  datasetNameResultSchema,
  datasetSchema,
  datasetSummarySchema,
} from "./dataset.ts";
import {
  datasetApiCopyInputSchema,
  datasetApiDatasetInputSchema,
  datasetApiDeleteInputSchema,
  datasetApiFindNextNameInputSchema,
  datasetApiProjectInputSchema,
  datasetApiUpdateMappingInputSchema,
  datasetApiUpsertBaseInputSchema,
  datasetApiUpsertTargetInputSchema,
  datasetApiValidateNameInputSchema,
} from "./dataset.schemas.ts";

/** What an archive or its undo answers. */
export const datasetDeletedSchema = z.object({ success: z.literal(true) }).strict();

export const datasetTrpc = defineTrpcContract("dataset")
  /** Creates a dataset, or replaces an existing one's columns and entries. */
  .mutation("upsert")
  .withInput(datasetApiUpsertBaseInputSchema.and(datasetApiUpsertTargetInputSchema))
  .withOutput(datasetSchema)

  /** The slug a proposed name would get, and whether it is available. */
  .query("validateDatasetName")
  .withInput(datasetApiValidateNameInputSchema)
  .withOutput(datasetNameResultSchema)

  /** Every dataset in the project, for the list and picker surfaces. */
  .query("getAll")
  .withInput(datasetApiProjectInputSchema)
  .withOutput(z.array(datasetSummarySchema))

  /** One dataset by id or slug; an archived or missing one reads as null. */
  .query("getById")
  .withInput(datasetApiDatasetInputSchema)
  .withOutput(datasetSchema.nullable())

  /** Archives a dataset, or restores one the caller just archived. */
  .mutation("deleteById")
  .withInput(datasetApiDeleteInputSchema)
  .withOutput(datasetDeletedSchema)

  /** The trace and thread mapping a dataset is filled from. */
  .mutation("updateMapping")
  .withInput(datasetApiUpdateMappingInputSchema)
  .withOutput(datasetSchema)

  /** The next free name for a proposed one. */
  .query("findNextName")
  .withInput(datasetApiFindNextNameInputSchema)
  .withOutput(z.string())

  /** The same dataset in another project, records and all. */
  .mutation("copy")
  .withInput(datasetApiCopyInputSchema)
  .withOutput(datasetSchema)
  .build();
