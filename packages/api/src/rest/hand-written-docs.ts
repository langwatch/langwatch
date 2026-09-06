import type { DescribeRouteOptions } from "hono-openapi";

import type { EndpointDocs } from "./types.ts";

/**
 * A hand-written operation, in the shape the endpoint chain documents with.
 * Families predating the chain keep raw `describeRoute` options; `security`
 * and path `parameters` are now framework-derived, so they are dropped here
 * rather than restated. Everything else a person wrote carries through
 * unchanged, including the request body, since a family parsing its own
 * body gives the framework no schema to derive one from.
 */
export function handWrittenDocs(spec: DescribeRouteOptions): EndpointDocs {
  return {
    ...(spec.summary === undefined ? {} : { summary: spec.summary }),
    ...(typeof spec.description === "string" ? { description: spec.description } : {}),
    ...(spec.tags ? { tags: [...spec.tags] } : {}),
    ...(typeof spec.operationId === "string" ? { operationId: spec.operationId } : {}),
    ...(spec.responses ? { responses: spec.responses } : {}),
    ...(spec.requestBody ? { requestBody: spec.requestBody } : {}),
  };
}
