import { resolver } from "hono-openapi/zod";
import type { RouteResponse } from "./types";

export const buildStandardSuccessResponse = (zodSchema: any): RouteResponse => {
  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};
