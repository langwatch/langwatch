import type { Context } from "hono";

import { parseApiSchemaSync } from "./schema.js";
import { ENDPOINT_ROUTE, type EndpointDef, type EndpointRegistration } from "./types.js";

/** Validates and serializes the value returned by a regular endpoint handler. */
export function serializeEndpointResult({
  c,
  config,
  kind,
  result,
}: {
  c: Context;
  config: EndpointDef;
  kind: EndpointRegistration["kind"];
  result: unknown;
}): Response {
  if (result instanceof Response) {
    // RPC keeps its existing raw-response escape hatch for streams, redirects,
    // and compatibility handlers. REST always declares and validates output.
    if ((kind === "rest" || kind === "public-rest") && config.output) {
      throw new TypeError("A handler with an output schema must return a value, not a Response");
    }
    return result;
  }

  // The success status of a value-returning handler is fixed at registration
  // rather than read off what it returned. `assertStatusInvariant` refuses an
  // `output` schema that accepts undefined, so a declared body is always
  // present. Choosing here is what previously let one operation answer 200 on
  // the request that found something and 204 on the one that did not.
  //
  // Reached only by an untyped caller, or a return type that drifted behind an
  // `any`: no declared body means no body.
  if (!config.output) {
    return c.body(null, config.status ?? 204);
  }

  const validation = parseApiSchemaSync(config.output, result);
  if (!validation.success) {
    // Deliberately a plain `Error`, not a `HandledError`. We know the cause,
    // but the caller cannot act on it — the handler returned something its own
    // declared schema rejects, which is our bug. It degrades to "unknown" plus
    // a trace id at the boundary, which is the correct outcome (ADR-045), and
    // logs at 500/error because it carries no `httpStatus` or `fault`.
    //
    // The endpoint is named because the log line otherwise identified this
    // only by the concrete URL, leaving "which endpoint breaks its own
    // contract" a question you had to answer by hand.
    const route = c.get(ENDPOINT_ROUTE) as string | undefined;
    throw new Error(`Response failed output validation${route ? ` for ${route}` : ""}`, {
      cause: validation.error,
    });
  }

  // Reachable only for a `z.void()` / `z.undefined()` output, because
  // `assertStatusInvariant` refuses any other schema that accepts undefined.
  // That is what makes this a fixed property of the endpoint rather than a
  // per-request coin flip: a no-body endpoint always takes this branch and
  // every other endpoint never does.
  if (validation.data === undefined) {
    return c.body(null, config.status ?? 204);
  }
  return c.json(validation.data, config.status ?? 200);
}
