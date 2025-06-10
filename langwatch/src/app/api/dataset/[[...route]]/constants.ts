import { errorSchema } from "./schemas";
import { resolver } from "hono-openapi/zod";
import type { RouteResponse } from "./types";

export const baseResponses: Record<number, RouteResponse> = {
  400: {
    description: "Bad Request",
    content: {
      "application/json": { schema: resolver(errorSchema) },
    },
  },
  401: {
    description: "Unauthorized",
    content: {
      "application/json": { schema: resolver(errorSchema) },
    },
  },
  422: {
    description: "Unprocessable Entity",
    content: {
      "application/json": { schema: resolver(errorSchema) },
    },
  },
  500: {
    description: "Internal Server Error",
    content: {
      "application/json": { schema: resolver(errorSchema) },
    },
  },
};
