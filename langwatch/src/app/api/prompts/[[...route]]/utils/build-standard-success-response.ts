import { resolver } from "hono-openapi/zod";
import type { ZodSchema } from "zod";

import type { RouteResponse } from "../../../shared/types";

/**
 * Builds a standard success response object for OpenAPI route definitions.
 *
 * This utility creates a consistent response structure for successful API operations,
 * converting a Zod schema into the OpenAPI response format expected by hono-openapi.
 *
 * @param zodSchema - The Zod schema that defines the shape of the response data
 * @returns A RouteResponse object with standardized success structure
 * @throws Error if zodSchema is not provided
 *
 * @example
 * ```typescript
 * const userSchema = z.object({ id: z.string(), name: z.string() });
 * const response = buildStandardSuccessResponse(userSchema);
 * // Returns: { description: "Success", content: { "application/json": { schema: ... } } }
 * ```
 */
export const buildStandardSuccessResponse = (
  zodSchema: ZodSchema
): RouteResponse => {
  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};
