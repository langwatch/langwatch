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

  const status = config.status ?? 200;
  if (config.output) {
    const validation = config.output.safeParse(result);
    if (!validation.success) {
      throw new Error("Response failed output validation", {
        cause: validation.error,
      });
    }
    if (validation.data === undefined) {
      return c.body(null, config.status ?? 204);
    }
    return c.json(validation.data, status);
  }

  if (result === undefined) {
    return c.body(null, 204);
  }

  return c.json(result, status);
}
