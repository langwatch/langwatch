import type { LlmConfigOutputType } from "~/types";
import {
  badRequestSchema,
  unauthorizedSchema,
  errorSchema,
} from "~/app/api/shared/schemas";
import { resolver } from "hono-openapi/zod";
import type { RouteResponse } from "./types";

export const llmOutputFieldToJsonSchemaTypeMap: Record<
  LlmConfigOutputType,
  string
> = {
  str: "string",
  float: "number",
  bool: "boolean",
  json_schema: "object",
} as const;

export const baseResponses: Record<number, RouteResponse> = {
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
  500: {
    description: "Internal Server Error",
    content: {
      "application/json": { schema: resolver(errorSchema) },
    },
  },
};
