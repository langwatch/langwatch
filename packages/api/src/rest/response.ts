import type { Context } from "hono";
import { createLogger, validationMeta } from "@langwatch/observability";

import { parseApiSchemaSync } from "../schema.ts";
import { ENDPOINT_ROUTE, type EndpointDef, type EndpointRegistration } from "./types.ts";

const outputLogger = createLogger("langwatch:api:output-validation");

/**
 * The answer a handler gives when the request is not its own after all: the
 * pipeline calls `next()` instead of writing a response, so the namespaces
 * mounted after this family keep their own routing and their own 404. Only an
 * any-method route can use it — every other route was matched by method and
 * path and owns what it matched.
 */
const DECLINED = Symbol.for("@langwatch/api/rest/declined");

/** The answer of a handler that is not the one to serve this request. */
export type Declined = { readonly [DECLINED]: true };

/** @see Declined */
export function declined(): Declined {
  return DECLINED_ANSWER;
}

const DECLINED_ANSWER: Declined = Object.freeze({ [DECLINED]: true as const });

/** True for the value {@link declined} returns. */
export function isDeclined(result: unknown): result is Declined {
  return result === DECLINED_ANSWER;
}

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
  // Declared to answer outside the JSON contract: the handler's own value is
  // written through.
  if (config.rawResponse) {
    if (result instanceof Response) return withDeclaredHeaders(result, config);
    if (result === undefined || result === null) {
      return withDeclaredHeaders(c.body(null, config.status ?? 204), config);
    }
    if (config.rawResponse.contentType) {
      c.header("Content-Type", config.rawResponse.contentType);
    }
    return withDeclaredHeaders(
      c.body(result as string | ArrayBuffer | ReadableStream, config.status ?? 200),
      config,
    );
  }

  if (result instanceof Response) {
    // Every REST route declares an output, so a raw Response is always a
    // handler breaking its own contract. SSE never reaches here.
    if ((kind === "rest" || kind === "public-rest") && config.output) {
      throw new TypeError("A handler with an output schema must return a value, not a Response");
    }
    return withDeclaredHeaders(result, config);
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
    return withDeclaredHeaders(c.body(null, config.status ?? 204), config);
  }

  const validation = parseApiSchemaSync(config.output, result);
  if (!validation.success) {
    const route = c.get(ENDPOINT_ROUTE) as string | undefined;
    outputLogger.error(
      {
        endpoint: route ?? "<unregistered>",
        method: c.req.method,
        path: c.req.path,
        validation: validationMeta(validation.error, { privacy: "schema-only" }),
      },
      "REST handler response did not match its declared output schema",
    );
    return withDeclaredHeaders(c.json(result, config.status ?? 200), config);
  }

  // Reachable only for a `z.void()` / `z.undefined()` output, because
  // `assertStatusInvariant` refuses any other schema that accepts undefined.
  // That is what makes this a fixed property of the endpoint rather than a
  // per-request coin flip: a no-body endpoint always takes this branch and
  // every other endpoint never does.
  if (validation.data === undefined) {
    return withDeclaredHeaders(c.body(null, config.status ?? 204), config);
  }
  return withDeclaredHeaders(c.json(validation.data, config.status ?? 200), config);
}

function withDeclaredHeaders(response: Response, config: EndpointDef): Response {
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    response.headers.set(name, value);
  }
  return response;
}
