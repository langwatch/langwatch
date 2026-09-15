import type { AuthConfig } from "@langwatch/scenario-contract";

type AuthStrategy = (auth: AuthConfig) => Record<string, string>;

const NO_HEADERS: Record<string, string> = Object.freeze({});

type AuthStrategyType = "none" | "bearer" | "api_key" | "basic";

/**
 * Authentication strategies mapped by type.
 * Each strategy returns headers to be added to the request.
 *
 * Note: The discriminated union type guarantees that each auth type has its
 * required fields, but we still narrow the type at runtime for type safety.
 */
export const AUTH_STRATEGIES: Record<AuthStrategyType, AuthStrategy> = {
  none: () => NO_HEADERS,
  bearer: (auth) =>
    auth.type === "bearer" ? { Authorization: `Bearer ${auth.token}` } : NO_HEADERS,
  api_key: (auth) => (auth.type === "api_key" ? { [auth.header]: auth.value } : NO_HEADERS),
  basic: (auth) =>
    auth.type === "basic"
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
export class HttpAuthAdapter {
  static create(): HttpAuthAdapter {
    return new HttpAuthAdapter();
  }

  private constructor() {}

  static apply(auth: AuthConfig | undefined): Record<string, string> {
    if (!auth) return NO_HEADERS;
    const strategy = AUTH_STRATEGIES[auth.type];
    return strategy ? strategy(auth) : NO_HEADERS;
  }
}

export const applyAuthentication = HttpAuthAdapter.apply;
