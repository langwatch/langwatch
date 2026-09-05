import type { DescribeRouteOptions } from "hono-openapi";

import type { EndpointDocs } from "./types.js";

/**
 * A hand-written operation, in the shape the endpoint chain documents with.
 *
 * Families that predate the chain keep their published operations in a rules
 * module, typed as the raw `describeRoute` options. Two of those keys the
 * framework now derives — `security` from the family's own door, and the path
 * `parameters` from the route's params schema — so they are dropped here
 * rather than restated per route. Everything a person wrote (the summary, the
 * prose, the response bodies, the operation id the SDK generators turn into
 * function names) is carried through unchanged.
 */
export function handWrittenDocs(spec: DescribeRouteOptions): EndpointDocs {
  return {
    ...(spec.summary === undefined ? {} : { summary: spec.summary }),
    ...(typeof spec.description === "string" ? { description: spec.description } : {}),
    ...(spec.tags ? { tags: [...spec.tags] } : {}),
    ...(typeof spec.operationId === "string" ? { operationId: spec.operationId } : {}),
    ...(spec.responses ? { responses: spec.responses } : {}),
  };
}
