import type { UserSignInMethod } from "@langwatch/user-contract";

const NAMED_METHODS: Readonly<Record<string, UserSignInMethod>> = {
  credential: "password",
  google: "google",
  github: "github",
  gitlab: "gitlab",
  microsoft: "microsoft",
  "azure-ad": "microsoft",
};

/**
 * A linked account's provider as a fixed code. Any other provider is an organization's own
 * connection, whose configured id can name the organization, so it reads as `sso`.
 */
export function signInMethodOf(provider: string): UserSignInMethod {
  return NAMED_METHODS[provider] ?? "sso";
}

/** Each code once, in a stable order. */
export function signInMethodsOf(providers: readonly string[]): UserSignInMethod[] {
  return [...new Set(providers.map(signInMethodOf))].toSorted();
}
