/**
 * Registering an identity provider (D09), in the parts that decide only
 * where to look. All of it runs at COMMAND time, never in the fold: what
 * the fold sees is a reference to something already checked.
 */

/**
 * Drop trailing slashes, so one issuer typed two ways is one address. A
 * scan, not `replace(/\/+$/, "")`: that regex is quadratic on customer-typed
 * input (CodeQL js/polynomial-redos).
 */
export function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;

  return value.slice(0, end);
}

/**
 * Where the discovery document lives. The specification's spelling: the
 * well-known path is appended INCLUDING any path the issuer carries, which
 * is what makes a multi-tenant issuer discoverable at all.
 */
export function discoveryEndpointFor({ issuer }: { issuer: string }): string {
  return `${withoutTrailingSlashes(issuer)}/.well-known/openid-configuration`;
}

/**
 * The two endpoints every provider publishes and every authorization-code
 * flow needs. Nothing beyond them is judged: the engine reads the document
 * properly at sign-in, and a second opinion would eventually disagree.
 */
export function looksLikeDiscoveryDocument(document: unknown): boolean {
  if (typeof document !== "object" || document === null) return false;
  const record: Record<string, unknown> = { ...document };

  return (
    typeof record.authorization_endpoint === "string" && typeof record.token_endpoint === "string"
  );
}
