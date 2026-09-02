/**
 * The locations the API description is published at, and the one sentence that
 * says why reading it needs no credential.
 *
 * Shared by the two discovery route modules so the copy in `/llms.txt` and the
 * paths a host routes to the API are the same strings rather than two that
 * agree today.
 */

/** The conventional location. What `/llms.txt` points at. */
export const WELL_KNOWN_OPENAPI_PATH = "/.well-known/openapi";

/** The same document under the API namespace, for a caller already inside it. */
export const API_OPENAPI_PATH = "/api/openapi.json";

/** The plain-text index, for a reader arriving with no schema in mind. */
export const LLMS_TXT_PATH = "/llms.txt";

/**
 * The discovery paths that sit outside `/api`. A host that only dispatches
 * `/api/*` into this process's Hono app dispatches on this as well; miss it and
 * the single-page-app fallback answers with the HTML shell and a 200 that a
 * caller reads as success.
 */
export const ROOT_DISCOVERY_PATHS: readonly string[] = [WELL_KNOWN_OPENAPI_PATH, LLMS_TXT_PATH];

/**
 * True for a root-level path that belongs to the API rather than the SPA.
 *
 * A single trailing slash counts. `/llms.txt/` is the same resource to every
 * client that would send it, and the cost of disagreeing is not a 404 — it is
 * the SPA fallback answering with the HTML shell and a 200 that the caller
 * reads as the document.
 */
export function isRootDiscoveryPath(pathname: string): boolean {
  const withoutTrailingSlash =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return ROOT_DISCOVERY_PATHS.includes(withoutTrailingSlash);
}

/** Escapes a literal path for embedding in a regular expression. */
const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The dev proxy rule matching exactly these paths, built here so a dev server
 * config cannot fall behind the list. A path added above but missed there would
 * reach Hono in production and the SPA in development — the worst shape of bug,
 * because it only appears where nobody is testing.
 *
 * Vite matches `server.proxy` regex keys against the full request URL, path and
 * query, so the optional trailing slash and query string are both part of it.
 */
export const ROOT_DISCOVERY_PROXY_PATTERN = `^(?:${ROOT_DISCOVERY_PATHS.map(escapeForRegExp).join(
  "|",
)})/?(?:\\?.*)?$`;

/**
 * Why every discovery location is unauthenticated. A caller reads the
 * description to learn how to authenticate, so requiring authentication to read
 * it would be circular, and it carries no tenant data.
 */
export const WHY_DISCOVERY_IS_PUBLIC =
  "the description of a public API; a caller reads it to learn how to authenticate, so requiring authentication to read it would be circular, and it carries no tenant data";
