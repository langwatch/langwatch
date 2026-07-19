import { z } from "zod";

/**
 * All supported dataset column types on the LangWatch platform.
 */
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
 * Zod schema for a single dataset column type value.
 */
export const datasetColumnTypeSchema = z.enum(DATASET_COLUMN_TYPES);

/**
 * Zod schema for a dataset column definition (name + type).
 *
 * Shared between create and update tool registrations.
 */
export const datasetColumnDefinitionSchema = z.object({
  name: z.string().describe("Column name"),
  type: datasetColumnTypeSchema.describe("Column type"),
});

/**
 * Zod schema for the platform_create_dataset MCP tool parameters.
 *
 * Extracted so it can be shared between the MCP tool registration
 * (create-mcp-server.ts) and unit tests.
 */
export const createDatasetSchema = z.object({
  name: z.string().min(1).describe("Dataset name"),
  columnTypes: z
    .array(datasetColumnDefinitionSchema)
    .optional()
    .describe("Column definitions for the dataset"),
});
