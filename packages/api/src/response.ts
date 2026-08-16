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
  // A handler that builds its own `Response` owns it completely — status,
  // body and all. This is the framework's deliberate opt-out, and it already
  // bypassed output validation long before the status rule below existed; a
  // redirect, a file stream and a hand-built error all need it. So the
  // invariant that follows governs VALUE-returning handlers. It is not a
  // guarantee about every byte an endpoint can emit, and `Handler` in
  // `types.ts` in fact requires a `Response` when no `output` is declared,
  // which makes the next branch unreachable from typed code.
  if (result instanceof Response) {
    return result;
  }

  // The success status of a value-returning handler is fixed at registration
  // rather than read off what it returned. `assertStatusInvariant` refuses an
  // `output` schema that accepts undefined, so a declared body is always
  // present. Choosing here is what previously let one operation answer 200 on
  // the request that found something and 204 on the one that did not.
  //
  // It also cost the declared status its meaning: the old undefined branch
  // used `config.status ?? 204`, so an endpoint declaring `status: 201` with an
  // optional output answered 201 with an empty body — a created response whose
  // own schema promised a representation.
  //
  // Reached only by an untyped caller, or a return type that drifted behind an
  // `any`: no declared body means no body.
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
