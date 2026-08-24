import { z } from "zod/v4";
import {
  datasetColumnTypeSchema,
  datasetColumnsSchema,
  datasetConfirmColumnsSchema,
  datasetRecordEntrySchema,
  datasetRecordInputSchema,
  datasetRecordFormSchema,
  type DatasetColumnType,
  type DatasetColumns,
  type DatasetConfirmColumns,
  type DatasetRecordEntry,
  type DatasetRecordInput,
  type DatasetRecordForm,
} from "@langwatch/dataset-contract";

export {
  datasetColumnTypeSchema,
  datasetColumnsSchema,
  datasetConfirmColumnsSchema,
  datasetRecordEntrySchema,
  datasetRecordInputSchema,
  datasetRecordFormSchema,
};
export type {
  DatasetColumnType,
  DatasetColumns,
  DatasetConfirmColumns,
  DatasetRecordEntry,
  DatasetRecordInput,
  DatasetRecordForm,
};

// Strict type for records from database - ID is always present
export const DATASET_COLUMN_TYPES = [
  "string",
  "boolean",
  "number",
  "date",
  "list",
  "json",
  "spans",
  "rag_contexts",
  "chat_messages",
  "annotations",
  "evaluations",
  "image",
] as const;


/**
 * Upload-confirm columns (ADR-032 v19+). Each confirm-step column carries an
 * immutable `sourceHeader` — the canonical (reserved-renamed / deduped) file
 * header it was parsed from — so the normalize step binds each file header to
 * its confirmed `name`+`type` BY HEADER, not by array position. That is what
 * lets the confirm UI drag-reorder and rename columns without scrambling the
 * data (positional binding silently maps values to the wrong column). The
 * field is transient: it rides the create call onto the dataset row, then
 * normalize strips it and persists a clean `DatasetColumns` in the user's
 * chosen order.
 */
export const annotationScoreSchema = z.object({
  label: z.string().optional(),
  value: z.string().optional(),
  reason: z.string().optional(),
  name: z.string().optional(),
  traceId: z.string().optional(),
});

export const evaluationsSchema = z.object({
  name: z.string(),
  type: z.string().optional().nullable(),
  passed: z.boolean().optional().nullable(),
  score: z.number().nullable(),
  label: z.string().optional().nullable(),
});

const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof literalSchema>;
type Json = Literal | { [key: string]: Json } | Json[];

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([literalSchema, z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);

export const datasetSpanSchema = z.record(z.string(), z.unknown());

export const datasetColumnTypeMapping: {
  [key in DatasetColumnType]: z.ZodType<any>;
} = {
  string: z.string().optional().nullable(),
  boolean: z.boolean().optional().nullable(),
  number: z.number().optional().nullable(),
  date: z.date().optional().nullable(),
  list: z.array(jsonSchema.optional().nullable()).optional().nullable(),
  json: jsonSchema.optional().nullable(),
  spans: z.array(datasetSpanSchema).optional().nullable(),
  rag_contexts: z.array(z.unknown()).optional().nullable(),
  chat_messages: z.array(z.unknown()).optional().nullable(),
  annotations: z.array(annotationScoreSchema).optional().nullable(),
  evaluations: z.array(evaluationsSchema).optional().nullable(),
  image: z.string().url().optional().nullable(),
};

export const newDatasetEntriesSchema = z.object({
  entries: z.array(
    z
      .object({
        id: z.string(),
      })
      .and(z.record(z.string(), z.any())),
  ),
});
