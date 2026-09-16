/**
 * The locations the API description is published at, and why reading it
 * needs no credential. Shared by both discovery route modules so `/llms.txt`
 * and the paths a host routes to stay the same strings, not two agreeing today.
 */

/** The conventional location. What `/llms.txt` points at. */
export const WELL_KNOWN_OPENAPI_PATH = "/.well-known/openapi";

/** The same document under the API namespace, for a caller already inside it. */
export const API_OPENAPI_PATH = "/api/openapi.json";

/** The plain-text index, for a reader arriving with no schema in mind. */
export const LLMS_TXT_PATH = "/llms.txt";

/**
 * The discovery paths that sit outside `/api`. A host dispatching only
 * `/api/*` into this process's Hono app must dispatch these too, or the SPA
 * fallback answers with the HTML shell and a 200 the caller reads as success.
 */
export const ROOT_DISCOVERY_PATHS: readonly string[] = [WELL_KNOWN_OPENAPI_PATH, LLMS_TXT_PATH];

/**
 * True for a root-level path that belongs to the API rather than the SPA. A
 * trailing slash counts: `/llms.txt/` is the same resource, and disagreeing
 * costs not a 404 but the SPA shell answering 200 as if it were the document.
 */
export function isRootDiscoveryPath(pathname: string): boolean {
  const withoutTrailingSlash =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return ROOT_DISCOVERY_PATHS.includes(withoutTrailingSlash);
}

/** Escapes a literal path for embedding in a regular expression. */
const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Dev proxy rule built here to stay in sync with ROOT_DISCOVERY_PATHS.
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
