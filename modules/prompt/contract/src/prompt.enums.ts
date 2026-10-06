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

/**
 * Recursively sorts object keys for deterministic JSON serialization; arrays
 * keep element order but sort each object element's keys. Lives in a neutral
 * module so the repository and version schema can both import it, avoiding a cycle.
 */
export function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return obj;
}
