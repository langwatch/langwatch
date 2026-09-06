import { resolver } from "hono-openapi";
import type { ZodType } from "zod";
import {
  apiErrorSchema,
  badRequestSchema,
  conflictSchema,
  errorSchema,
  unauthorizedSchema,
} from "./schemas.ts";
import type { RouteResponse } from "./response-types.ts";

/**
 * The documented errors for the families that predate the canonical envelope,
 * in the flat `{ error, message? }` shape they actually emit. Do not migrate
 * this in place: the apps importing it publish that shape to live consumers,
 * so changing it here would make ~21 apps' docs describe a body they do not
 * send. A family that moves to the canonical envelope switches to
 * {@link canonicalBaseResponses} at the same time it flips.
 */
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

/** One documented error body, the canonical envelope, for a given status. */
function canonicalResponse(description: string): RouteResponse {
  return {
    description,
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  };
}

/**
 * The documented errors for families that publish the canonical envelope
 * ({@link apiErrorSchema}): 400/401/500 match whichever layer refused. 422
 * is absent on purpose — validation failures answer 400 `validation_error`
 * — but a route refusing on a deliberate ceiling instead of shape does send
 * 422, documented by spreading {@link canonicalUnprocessableResponses}.
 */
export const canonicalBaseResponses: Record<number, RouteResponse> = {
  400: canonicalResponse("Bad Request"),
  401: canonicalResponse("Unauthorized"),
  403: canonicalResponse("Forbidden"),
  500: canonicalResponse("Internal Server Error"),
};

/**
 * The canonical 422, for routes that refuse a well-formed request on a
 * deliberate ceiling rather than on its shape.
 *
 * Kept separate from {@link canonicalBaseResponses} so that spreading it is a
 * per-route statement that this route really can answer 422 — the families
 * that only ever answer 400 for a bad request stay accurate by omission.
 */
export const canonicalUnprocessableResponses: Record<422, RouteResponse> = {
  422: canonicalResponse("Unprocessable Entity"),
};

/** The canonical 409, for families that publish the canonical envelope. */
export const canonicalConflictResponses: Record<409, RouteResponse> = {
  409: canonicalResponse("Conflict"),
};

/**
 * The documented 200 for a route that answers with one schema.
 *
 * Every family spelled this out itself, which is three lines of ceremony per
 * route and a shape that has to stay identical for the generated clients to
 * agree. One definition here so a change to the success envelope reaches every
 * family that publishes one.
 */
export const buildStandardSuccessResponse = (zodSchema: ZodType): RouteResponse => {
  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};
