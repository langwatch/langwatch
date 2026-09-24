import { z } from "zod";
/**
 * Schema version enum for LLM configuration
 * Used to track and manage schema evolution over time
 * Corresponds to the schemaVersion field in LlmPromptConfigVersion model
 */
export enum SchemaVersion {
  V1_0 = "1.0",
}

/**
 * The column types a prompt's inline dataset may declare. Named here rather
 * than imported from the dataset contract: a contract that imports another
 * contract chains the build, and these are the types PROMPTS accept.
 */
export const datasetColumnTypeSchema = z.enum([
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
  "file",
]);
