import type { FeatureApiIdentity, FeatureApiToken } from "./feature-api-token.ts";

/** Constructor tokens remain for installers awaiting the feature API cutover. */
export type DependencyToken<T> = FeatureApiToken<T> | (abstract new (...args: never[]) => T);

export type TokenIdentity = FeatureApiIdentity | (abstract new (...args: never[]) => unknown);

/** The dependency keys a feature declares, each pointing at its token. */
export type TokenMap = Readonly<Record<string, TokenIdentity>>;

/** The instances a {@link TokenMap} resolves to once the graph is built. */
export type ResolvedTokens<Tokens extends TokenMap> = {
  readonly [Key in keyof Tokens]: Tokens[Key] extends DependencyToken<infer Instance>
    ? Instance
    : never;
};

/** An empty declaration, so a feature that needs nothing states nothing. */
export const NO_TOKENS: Readonly<Record<never, never>> = Object.freeze({});

/** The name a boot error prints for a token. */
export function tokenName(token: TokenIdentity): string {
  return token.name.length > 0 ? token.name : "<anonymous token>";
}
