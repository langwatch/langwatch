import type { Context } from "hono";

import type { EndpointConfig } from "./types.js";

/** Validates and serializes the value returned by a regular endpoint handler. */
export function serializeEndpointResult({
  c,
  config,
  result,
}: {
  c: Context;
  config: EndpointConfig;
  result: unknown;
}): Response {
  if (result instanceof Response) {
    return result;
  }

  // The success status is fixed at registration, not read off the handler's
  // return value. `assertStatusInvariant` refuses an `output` schema that
  // accepts undefined, so a declared body is always present and an endpoint
  // without one never has a body to send. Choosing here is what previously let
  // a single operation answer 200 on one request and 204 on the next.
  //
  // It also cost the declared status its meaning: the old undefined branch
  // used `config.status ?? 204`, so an endpoint declaring `status: 201` with an
  // optional output answered 201 with an empty body — a created response whose
  // own schema promised a representation.
  // No declared body: the endpoint has none to send, whatever the handler
  // happened to return. Reading the return value here is what let an
  // undeclared, unvalidated payload reach the wire.
  if (!config.output) {
    return c.body(null, config.status ?? 204);
  }

  const validation = config.output.safeParse(result);
  if (!validation.success) {
    throw new Error("Response failed output validation", {
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
