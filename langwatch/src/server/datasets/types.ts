import { z } from "zod";
import {
  baseSpanSchema,
  chatMessageSchema,
  lLMSpanSchema,
  rAGChunkSchema,
  rAGSpanSchema,
} from "../tracer/types";

// Strict type for records from database - ID is always present
export const datasetRecordEntrySchema = z
  .object({ id: z.string() })
  .and(z.record(z.string(), z.any()));
export type DatasetRecordEntry = z.infer<typeof datasetRecordEntrySchema>;

// Input type for creating new records - ID is optional (backend generates with nanoid)
export const datasetRecordInputSchema = z
  .object({ id: z.string().optional() })
  .and(z.record(z.string(), z.any()));
export type DatasetRecordInput = z.infer<typeof datasetRecordInputSchema>;

// TODO: fix this list being repeated 3 times
export const datasetColumnTypeSchema = z.union([
  z.literal("string"),
  z.literal("boolean"),
  z.literal("number"),
  z.literal("date"),
  z.literal("list"),
  z.literal("json"),
  z.literal("spans"),
  z.literal("rag_contexts"),
  z.literal("chat_messages"),
  z.literal("annotations"),
  z.literal("evaluations"),
  z.literal("image"),
]);

export type DatasetColumnType = z.infer<typeof datasetColumnTypeSchema>;

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

export const datasetColumnsSchema = z.array(
  z.object({ name: z.string(), type: datasetColumnTypeSchema }),
);
export type DatasetColumns = z.infer<typeof datasetColumnsSchema>;

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
export const datasetConfirmColumnsSchema = z
  .array(
    z.object({
      name: z.string(),
      type: datasetColumnTypeSchema,
      sourceHeader: z.string(),
    }),
  )
  // Names become the stored record keys (normalize writes `out[target.name]`),
  // so a blank name yields an `""`-keyed column and a duplicated name collapses
  // two columns onto one key — the second silently overwriting the first in
  // every row. Reject both at the boundary rather than persist a corrupt
  // dataset (the confirm UI blocks the same cases before upload).
  .superRefine((columns, ctx) => {
    const seen = new Set<string>();
    columns.forEach((column, index) => {
      if (column.name.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "column name must not be blank",
          path: [index, "name"],
        });
      }
      if (seen.has(column.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate column name: ${column.name}`,
          path: [index, "name"],
        });
      }
      seen.add(column.name);
    });
  });
export type DatasetConfirmColumns = z.infer<typeof datasetConfirmColumnsSchema>;

export const datasetRecordFormSchema = z.object({
  name: z.string().min(1),
  columnTypes: datasetColumnsSchema,
});
export type DatasetRecordForm = z.infer<typeof datasetRecordFormSchema>;

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
  z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)]),
);

export const datasetSpanSchema = z.union([
  baseSpanSchema
    .omit({
      trace_id: true,
      timestamps: true,
      metrics: true,
      params: true,
    })
    .extend({
      params: z.record(z.string(), z.any()),
      model: z.string().optional(),
    }),
  lLMSpanSchema
    .omit({
      trace_id: true,
      timestamps: true,
      metrics: true,
      params: true,
    })
    .extend({
      params: z.record(z.string(), z.any()),
      model: z.string().optional(),
    }),
  rAGSpanSchema
    .omit({
      trace_id: true,
      timestamps: true,
      metrics: true,
      params: true,
    })
    .extend({
      params: z.record(z.string(), z.any()),
      model: z.string().optional(),
    }),
]);

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
  rag_contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  chat_messages: z.array(chatMessageSchema).optional().nullable(),
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
      .and(z.record(z.any())),
  ),
});
