/**
 * Root-level paths the API owns, not the SPA — unproxied in dev, a request
 * falls through to the HTML shell with a 200. A second copy of `apps/api`'s
 * `discovery-locations.ts`; held to shape by `vite-browser-entry.unit.test.ts`.
 */

/** The conventional location of the API description, and the plain-text index. */
export const ROOT_DISCOVERY_PATHS: readonly string[] = ["/.well-known/openapi", "/llms.txt"];

/** Escapes a literal path for embedding in a regular expression. */
const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The dev-proxy rule matching exactly those paths — Vite matches
 * `server.proxy` regex keys against the full URL, so trailing slash and
 * query string are both part of the pattern.
 */
export function rootDiscoveryProxyPattern(paths: readonly string[] = ROOT_DISCOVERY_PATHS): string {
  return `^(?:${paths.map(escapeForRegExp).join("|")})/?(?:\\?.*)?$`;
}
