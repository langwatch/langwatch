import type { LlmConfigOutputType } from "~/types";
import { badRequestSchema, unauthorizedSchema } from "./schemas";
import { resolver } from "hono-openapi/zod";

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
    description: "Unauthorized",
    content: {
      "application/json": { schema: resolver(unauthorizedSchema) },
    },
  },
  400: {
    description: "Bad Request",
    content: {
      "application/json": { schema: resolver(badRequestSchema) },
    },
  },
};
