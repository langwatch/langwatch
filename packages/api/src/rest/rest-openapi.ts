/**
 * What a declared REST route publishes: its operation id and the answer the
 * declaration named.
 */

// Parameters and the request body are NOT written here: hono-openapi's own
// validators already carry that metadata, and the document is generated from
// the mounted app.
import type { MiddlewareHandler } from "hono";
import { describeRoute, resolver, type DescribeRouteOptions } from "hono-openapi";

import type { RestTransportRoute } from "./rest-router.ts";

/**
 * The operation id one mount publishes. Every version mount needs a distinct
 * id because OpenAPI requires it to be unique across the whole document, so
 * the declared name belongs to whichever mount a client is told to call — the
 * bare alias — and every other mount suffixes the version it serves.
 */
export function operationIdOf({
  operation,
  suffix,
}: {
  operation: string;
  suffix?: string | undefined;
}): string {
  return suffix ? `${operation}_${suffix}` : operation;
}

/** The OpenAPI block one declared route publishes at one of its mounts. */
export function restRouteDocumentation({
  route,
  suffix,
}: {
  route: RestTransportRoute<unknown>;
  suffix?: string | undefined;
}): DescribeRouteOptions {
  const status = String(route.status ?? 200);

  const options: DescribeRouteOptions = {
    responses: {
      [status]: {
        description: "Success",
        content: { "application/json": { schema: resolver(route.output) } },
      },
    },
    operationId: operationIdOf({ operation: route.operation, suffix }),
  };

  if (route.docs?.description !== undefined) options.description = route.docs.description;

  if (route.docs?.summary !== undefined) options.summary = route.docs.summary;

  return options;
}

/** The same block, as the middleware that attaches it to a mounted route. */
export function documentRoute(input: {
  route: RestTransportRoute<unknown>;
  suffix?: string | undefined;
}): MiddlewareHandler {
  return describeRoute(restRouteDocumentation(input));
}
