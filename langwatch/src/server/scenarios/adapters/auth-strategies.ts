/**
 * Shared authentication strategies for HTTP agent adapters.
 *
 * Extracted to eliminate duplication between http-agent.adapter.ts
 * and standalone-adapters.ts.
 */

/**
 * Authentication configuration for HTTP requests.
 */
export type AuthConfig = {
  type: "none" | "bearer" | "api_key" | "basic";
  token?: string;
  header?: string;
  value?: string;
  username?: string;
  password?: string;
};

type AuthStrategy = (auth: AuthConfig) => Record<string, string>;

const NO_HEADERS: Record<string, string> = Object.freeze({});

type AuthStrategyType = "none" | "bearer" | "api_key" | "basic";

/**
 * Authentication strategies mapped by type.
 * Each strategy returns headers to be added to the request.
 */
export const AUTH_STRATEGIES: Record<AuthStrategyType, AuthStrategy> = {
  none: () => NO_HEADERS,
  bearer: (auth) =>
    auth.type === "bearer" && auth.token
      ? { Authorization: `Bearer ${auth.token}` }
      : NO_HEADERS,
  api_key: (auth) =>
    auth.type === "api_key" && auth.header && auth.value
      ? { [auth.header]: auth.value }
      : NO_HEADERS,
  basic: (auth) =>
    auth.type === "basic" && auth.username
      ? {
          Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password ?? ""}`).toString("base64")}`,
        }
      : NO_HEADERS,
};

/**
 * Applies authentication to request headers based on the auth configuration.
 *
 * @param auth - The authentication configuration (optional)
 * @returns Headers to merge with the request
 */
export function applyAuthentication(
  auth: AuthConfig | undefined,
): Record<string, string> {
  if (!auth) return NO_HEADERS;
  const strategy = AUTH_STRATEGIES[auth.type as AuthStrategyType];
  return strategy ? strategy(auth) : NO_HEADERS;
}
