import type { MiddlewareHandler } from "hono";
import { uniqueSymbol } from "hono-openapi";

/** The canonical published API generation. Every `/api` family answers here. */
export const V1_PREFIX = "/api/v1";

const VERSION_SEGMENT = /^v\d+$/;

/**
 * The `/api/v1` form of a bare `/api/...` route path, or `null` when the path
 * must not be aliased.
 */
export function canonicalV1Path(path: string): string | null {
  if (path !== "/api" && !path.startsWith("/api/")) return null;
  const rest = path.slice("/api".length);
  if (rest === "" || rest === "/") return null;
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => VERSION_SEGMENT.test(segment))) return null;
  return `${V1_PREFIX}${rest}`;
}

/**
 * The same handler stack with hono-openapi's route metadata detached.
 */
export function undescribedStack(stack: readonly MiddlewareHandler[]): MiddlewareHandler[] {
  return stack.map((handler) => {
    if (Reflect.get(handler, uniqueSymbol) === void 0) return handler;
    const passthrough: MiddlewareHandler = async (context, next) => handler(context, next);
    return passthrough;
  });
}
