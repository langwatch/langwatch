import { resolver } from "hono-openapi";
import type { RouteResponse } from "../../shared/types";

export const buildStandardSuccessResponse = (zodSchema: any): RouteResponse => {
  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};
