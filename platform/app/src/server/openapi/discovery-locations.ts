/**
 * The locations the API description is published at, and the one sentence that
 * says why reading it needs no credential.
 *
 * Shared by the two discovery route modules so the copy in `/llms.txt`, the URL
 * the RPC catalogue points back at, and the paths `start.ts` routes to the API
 * are the same strings rather than three that agree today.
 */

/** The conventional location. What `/llms.txt` and the catalogue point at. */
export const WELL_KNOWN_OPENAPI_PATH = "/.well-known/openapi";

/** The same document under the API namespace, for a caller already inside it. */
export const API_OPENAPI_PATH = "/api/openapi.json";

/** The RPC catalogue: a projection of the document, POST because it is an RPC. */
export const RPC_DISCOVER_PATH = "/api/rpc.discover";

/** The plain-text index, for a reader arriving with no schema in mind. */
export const LLMS_TXT_PATH = "/llms.txt";

/**
 * The discovery paths that sit outside `/api`. `start.ts` dispatches on this,
 * and `vite.config.ts` proxies the same two in dev; miss either and the
 * single-page-app fallback answers with the HTML shell and a 200 that a caller
 * reads as success.
 */
export const ROOT_DISCOVERY_PATHS: readonly string[] = [
  WELL_KNOWN_OPENAPI_PATH,
  LLMS_TXT_PATH,
];

/** True for a root-level path that belongs to the API rather than the SPA. */
export function isRootDiscoveryPath(pathname: string): boolean {
  return ROOT_DISCOVERY_PATHS.includes(pathname);
}

/**
 * Why every discovery location is unauthenticated. A caller reads the
 * description to learn how to authenticate, so requiring authentication to read
 * it would be circular, and it carries no tenant data.
 */
export const WHY_DISCOVERY_IS_PUBLIC =
  "the description of a public API; a caller reads it to learn how to authenticate, so requiring authentication to read it would be circular, and it carries no tenant data";
