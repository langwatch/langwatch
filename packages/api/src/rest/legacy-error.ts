/**
 * Main's root `error` beside the canonical envelope, on a route that publishes main's flat
 * `{ error, message? }` body at the refusal's status: released clients parse it (Alex,
 * 2026-10-06, night; ARCHITECTURE.md §12). The route's published answers are the declaration.
 */
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";

import type { RestTransportRoute } from "./declaration.ts";
import { flatErrorStatuses } from "./openapi.ts";
import { legacyErrorOf } from "./response.ts";

type Route = RestTransportRoute<unknown>;

const flatStatusesByRoute = new WeakMap<Route, Promise<ReadonlySet<number>>>();
const routeByRequest = new WeakMap<Context, Route>();

/** Marks the request with its route, when that route documents any refusal at all. */
export function legacyErrorScopes(route: Route): MiddlewareHandler[] {
  if (!documentsRefusal(route)) return [];

  return [
    async (context, next) => {
      routeByRequest.set(context, route);
      await next();
    },
  ];
}

/** The family's boundary, with main's root `error` added where the route publishes it. */
export function withLegacyError(onError: ErrorHandler): ErrorHandler {
  return async (failure, context) => {
    const answer = await onError(failure, context);
    const route = routeByRequest.get(context);

    if (route === undefined || !(await flatStatusesOf(route)).has(answer.status)) return answer;

    const body: unknown = await answer
      .clone()
      .json()
      .catch(() => undefined);

    if (!isEnvelope(body)) return answer;

    const error = legacyErrorOf({ failure, code: body.code, status: answer.status });
    const rendered = new Response(JSON.stringify({ error, ...body }), answer);
    rendered.headers.delete("Content-Length");

    return rendered;
  };
}

/** Read once per route, on its first refusal: a boot never converts a schema it never sends. */
function flatStatusesOf(route: Route): Promise<ReadonlySet<number>> {
  const known = flatStatusesByRoute.get(route);
  if (known) return known;

  const statuses = flatErrorStatuses(route);
  flatStatusesByRoute.set(route, statuses);

  return statuses;
}

function documentsRefusal(route: Route): boolean {
  const statuses = [
    ...Object.keys(route.answers ?? {}),
    ...Object.keys(route.docs?.responses ?? {}),
  ];

  return statuses.some((status) => Number(status) >= 400);
}

/** The canonical envelope, not a body a family's own boundary already wrote flat. */
function isEnvelope(body: unknown): body is Record<string, unknown> & { code: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    !("error" in body) &&
    typeof (body as { code?: unknown }).code === "string"
  );
}
