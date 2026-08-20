import type { LlmConfigOutputType } from "~/types";

export const llmOutputFieldToJsonSchemaTypeMap: Record<
  LlmConfigOutputType,
  string
> = {
  str: "string",
  float: "number",
  bool: "boolean",
  json_schema: "object",
} as const;
