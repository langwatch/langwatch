/**
 * Every `dataset.*` procedure, declared once: its name, its kind, what it takes
 * and what it answers. The server binds a permission and a handler to a name
 * declared here; the browser reads the same names and schemas as types.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { datasetLimitsSchema } from "./dataset-limits.ts";
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
import {
  DATASET_NORMALIZATION_SETTLED_EVENT_TYPE,
  appendStoredObjectToDatasetInputSchema,
  createDatasetAttachmentUploadInputSchema,
  datasetAttachmentUploadSchema,
  createDatasetFromStoredObjectInputSchema,
  datasetImportAppendedSchema,
  datasetImportStartedSchema,
  datasetNameResultSchema,
  datasetSummaryWireSchema,
  datasetWireSchema,
  retryNormalizeInputSchema,
  uploadProcessingSchema,
} from "./dataset.ts";

/** What an archive or its undo answers. */
const datasetDeletedSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface DatasetDeletedSchema extends Named<typeof datasetDeletedSchemaDefinition> {}
export const datasetDeletedSchema: DatasetDeletedSchema = datasetDeletedSchemaDefinition;

export const datasetTrpc = defineTrpcContract("dataset")
  /** Creates a dataset, or replaces an existing one's columns and entries. */
  .mutation("upsert")
  .withInput(
    z.object({
      ...datasetApiUpsertBaseInputSchema.shape,
      ...datasetApiUpsertTargetInputSchema.shape,
    }),
  )
  .withOutput(datasetWireSchema)

  /** The slug a proposed name would get, and whether it is available. */
  .query("validateDatasetName")
  .withInput(datasetApiValidateNameInputSchema)
  .withOutput(datasetNameResultSchema)

  /** Every dataset in the project, for the list and picker surfaces. */
  .query("getAll", { invalidatedBy: [DATASET_NORMALIZATION_SETTLED_EVENT_TYPE] })
  .withInput(datasetApiProjectInputSchema)
  .withOutput(z.array(datasetSummaryWireSchema))

  /** One dataset by id or slug; an archived or missing one reads as null. */
  .query("getById", { invalidatedBy: [DATASET_NORMALIZATION_SETTLED_EVENT_TYPE] })
  .withInput(datasetApiDatasetInputSchema)
  .withOutput(datasetWireSchema.nullable())

  /** Archives a dataset, or restores one the caller just archived. */
  .mutation("deleteById")
  .withInput(datasetApiDeleteInputSchema)
  .withOutput(datasetDeletedSchema)

  /** The trace and thread mapping a dataset is filled from. */
  .mutation("updateMapping")
  .withInput(datasetApiUpdateMappingInputSchema)
  .withOutput(datasetWireSchema)

  /** The next free name for a proposed one. */
  .query("findNextName")
  .withInput(datasetApiFindNextNameInputSchema)
  .withOutput(z.string())

  /** The same dataset in another project, records and all. */
  .mutation("copy")
  .withInput(datasetApiCopyInputSchema)
  .withOutput(datasetWireSchema)

  /** A new dataset from a confirmed `dataset_import` file, prepared in the background (ADR-158). */
  .mutation("createFromStoredObject")
  .withInput(createDatasetFromStoredObjectInputSchema)
  .withOutput(datasetImportStartedSchema)

  /** A confirmed `dataset_import` file's rows, added to an existing dataset. */
  .mutation("appendStoredObject")
  .withInput(appendStoredObjectToDatasetInputSchema)
  .withOutput(datasetImportAppendedSchema)

  /** The size limits the project's organization answers, for the browser's own checks. */
  .query("getLimits")
  .withInput(datasetApiProjectInputSchema)
  .withOutput(datasetLimitsSchema)

  /** The signed upload a file for an image or file cell is sent to. */
  .mutation("createAttachmentUpload")
  .withInput(createDatasetAttachmentUploadInputSchema)
  .withOutput(datasetAttachmentUploadSchema)

  /** A dataset whose preparation failed or stalled, prepared again from the same stored file. */
  .mutation("retryNormalize")
  .withInput(retryNormalizeInputSchema)
  .withOutput(uploadProcessingSchema)
  .build();
