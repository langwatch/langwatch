/**
 * The root-level paths the API owns rather than the single-page application.
 *
 * `/api/*` is unambiguous; these two are not. They sit at the document root, so
 * in development — where Vite owns the root — a request for one falls through
 * to the SPA unless the dev server proxies it, and the SPA answers an agent's
 * discovery request with the HTML shell and a 200 the caller reads as success.
 *
 * `apps/api/src/features/discovery/discovery-locations.ts` is the authority for
 * the list. It cannot be imported here: a browser application does not depend
 * on the API process. Until the list lives in a package both sides can read,
 * this is a second copy, and `tests/vite-browser-entry.unit.test.ts` is what
 * holds it to the same shape.
 */

/** The conventional location of the API description, and the plain-text index. */
export const ROOT_DISCOVERY_PATHS: readonly string[] = ["/.well-known/openapi", "/llms.txt"];

/** Escapes a literal path for embedding in a regular expression. */
const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The dev-proxy rule matching exactly those paths.
 *
 * Vite matches `server.proxy` regex keys against the full request URL, path and
 * query, so the optional trailing slash and query string are both part of it.
 */
export function rootDiscoveryProxyPattern(paths: readonly string[] = ROOT_DISCOVERY_PATHS): string {
  return `^(?:${paths.map(escapeForRegExp).join("|")})/?(?:\\?.*)?$`;
}
