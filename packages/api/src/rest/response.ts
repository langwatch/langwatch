import type { Context } from "hono";

import { parseApiSchemaSync } from "../schema.js";
import { ENDPOINT_ROUTE, type EndpointDef, type EndpointRegistration } from "./types.js";

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
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    c.header(name, value);
  }

  // Declared to answer outside the JSON contract: the handler's own value is
  // written through. A whole Response is passed on untouched, because a
  // redirect, a 304 and a streamed body each carry headers of their own that
  // this function has no business rewriting.
  if (config.rawResponse) {
    if (result instanceof Response) return result;
    if (result === undefined || result === null) {
      return c.body(null, config.status ?? 204);
    }
    if (config.rawResponse.contentType) {
      c.header("Content-Type", config.rawResponse.contentType);
    }
    return c.body(result as string | ArrayBuffer | ReadableStream, config.status ?? 200);
  }

  if (result instanceof Response) {
    // Every REST route declares an output, so a raw Response is always a
    // handler breaking its own contract. SSE never reaches here.
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
