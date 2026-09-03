/**
 * Marking a whole route family as a deprecated alias.
 *
 * A family that has a successor says so on every response, refusals included,
 * so an integrator reading the wire finds the move without reading the docs.
 * The two headers are the standard pair: `Deprecation` states the fact, and
 * the `Link` relation names where the family went.
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
    await next();
    c.header("Deprecation", "true");
    c.header("Link", `<${successor}>; rel="successor-version"`);
  };
}
