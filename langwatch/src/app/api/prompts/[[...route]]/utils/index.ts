import { resolver } from "hono-openapi/zod";

import type { RouteResponse } from "../../../shared/types";

export * from "./handle-possible-conflict-error";
export * from "./api-mappings";

export const buildStandardSuccessResponse = (zodSchema: any): RouteResponse => {
  if (!zodSchema) {
    throw new Error("schema required");
  }

  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};
