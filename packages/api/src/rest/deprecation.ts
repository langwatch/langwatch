/**
 * Marking a whole route family as a deprecated alias.
 */
import type { MiddlewareHandler } from "hono";

/**
 * Sets `Deprecation: true` and a `successor-version` link on every response of
 * the family it is applied to.
 */
export function deprecatedAlias({
  successor,
}: {
  /** The path of the family that replaces this one. */
  successor: string;
}): MiddlewareHandler {
  return async (c, next) => {
    // Prepared before the handler runs, so a refusal the family THROWS carries
    // them too: a header written after `next()` is never reached once the
    // error is on its way to the boundary.
    c.header("Deprecation", "true");
    c.header("Link", `<${successor}>; rel="successor-version"`);
    await next();
  };
}
