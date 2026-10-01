/** Secrets minted from an HTTP credential carry this prefix; a secrets-screen secret stays unbound. */
const MINTED_SECRET_NAME = /^HTTP_/;

export function isMintedFromHttpCredential(name: string): boolean {
  return MINTED_SECRET_NAME.test(name);
}

/**
 * The one origin an existing HTTP-minted secret is bound to: the origin every call referencing
 * it sends it to. None where the calls disagree, or one has no fixed origin ("").
 */
export function originToBind(origins: ReadonlySet<string>): string | undefined {
  const [origin] = origins;

  return origins.size === 1 && origin ? origin : undefined;
}
