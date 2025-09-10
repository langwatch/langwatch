import { resolver } from "hono-openapi/zod";

import type { RouteResponse } from "./types";

import {
  badRequestSchema,
  unauthorizedSchema,
  errorSchema,
  conflictSchema,
} from "~/app/api/shared/schemas";

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

export const conflictResponses: Record<409, RouteResponse> = {
  409: {
    description: "Conflict",
    content: {
      "application/json": { schema: resolver(conflictSchema) },
    },
  },
};
