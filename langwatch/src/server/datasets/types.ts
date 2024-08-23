import { z } from "zod";
import {
  datasetSpanSchema,
  chatMessageSchema,
  rAGChunkSchema,
} from "../tracer/types.generated";

export type DatasetRecordEntry = { id: string } & Record<string, any>;

export type DatasetColumnType =
  | "string"
  | "boolean"
  | "number"
  | "json"
  | "spans"
  | "rag_contexts"
  | "chat_messages"
  | "annotations"
  | "evaluations";

export type DatasetColumnTypes = Record<string, DatasetColumnType>;

export type DatasetRecordForm = {
  /**
   * @minLength 1
   */
  name: string;
  columnTypes: DatasetColumnTypes;
};

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

export const datasetColumnTypeMapping: {
  [key in DatasetColumnType]: z.ZodType<any>;
} = {
  string: z.string().optional().nullable(),
  boolean: z.boolean().optional().nullable(),
  number: z.number().optional().nullable(),
  json: z.any().optional().nullable(),
  spans: z.array(datasetSpanSchema).optional().nullable(),
  rag_contexts: z.array(rAGChunkSchema).optional().nullable(),
  chat_messages: z.array(chatMessageSchema).optional().nullable(),
  annotations: z.array(annotationScoreSchema).optional().nullable(),
  evaluations: z.array(evaluationsSchema).optional().nullable(),
};

export const newDatasetEntriesSchema = z.object({
  entries: z.array(
    z
      .object({
        id: z.string(),
      })
      .and(z.record(z.any()))
  ),
});
