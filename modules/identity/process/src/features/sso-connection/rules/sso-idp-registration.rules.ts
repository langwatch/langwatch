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

/** A descriptor names itself, and either wrapper is legitimate. What must be
 *  there is the identity provider role: a document describing only a service
 *  provider is somebody's own metadata in the wrong box. */
export function looksLikeSamlDescriptor(xml: string): boolean {
  return (
    /<(?:[A-Za-z0-9._-]+:)?Entit(?:y|ies)Descriptor[\s>]/.test(xml) &&
    /<(?:[A-Za-z0-9._-]+:)?IDPSSODescriptor[\s>]/.test(xml)
  );
}

/** A certificate is base64 that decodes to a DER SEQUENCE; both the armoured
 *  and the bare form are handed out. Proves the bytes are readable and nothing
 *  else — whether the key signs assertions is a sign-in's question. */
export function looksLikeCertificate(certificate: string): boolean {
  const body = certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  if (body.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false;
  try {
    const der = Buffer.from(body, "base64");
    return der.length >= 64 && der[0] === 0x30;
  } catch {
    return false;
  }
}

/** A field somebody left blank is a field they did not supply; the empty
 *  string is that absence, folded to the stored shape's null at the edge. */
export function trimmedText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
