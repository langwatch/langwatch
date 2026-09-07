/**
 * A dependency token is the abstract contract service class a provider
 * satisfies. Not a string, not a symbol, not a type alias: the class carries
 * the members, so a provider that no longer answers the contract fails to
 * compile, and the class NAME is what a boot failure can print.
 */
export type DependencyToken<T> = abstract new (...args: never[]) => T;

/** The dependency keys a feature declares, each pointing at its token. */
export type TokenMap = Readonly<Record<string, DependencyToken<unknown>>>;

/** The instances a {@link TokenMap} resolves to once the graph is built. */
export type ResolvedTokens<Tokens extends TokenMap> = {
  readonly [Key in keyof Tokens]: Tokens[Key] extends DependencyToken<infer Instance>
    ? Instance
    : never;
};

/** An empty declaration, so a feature that needs nothing states nothing. */
export const NO_TOKENS: Readonly<Record<never, never>> = Object.freeze({});

/** The name a boot error prints for a token. */
export function tokenName(token: DependencyToken<unknown>): string {
  const named = token as { name?: string };
  return named.name && named.name.length > 0 ? named.name : "<anonymous token>";
}
