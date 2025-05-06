import type { LlmConfigOutputType } from "~/types";
import { badRequestSchema, unauthorizedSchema } from "./schemas";

export const llmOutputFieldToJsonSchemaTypeMap: Record<
  LlmConfigOutputType,
  string
> = {
  str: "string",
  float: "number",
  bool: "boolean",
  json_schema: "object",
} as const;

export const baseResponses = {
  401: {
    content: {
      "application/json": { schema: unauthorizedSchema },
    },
  },
  400: {
    content: {
      "application/json": { schema: badRequestSchema },
    },
  },
};
