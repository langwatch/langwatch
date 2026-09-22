/**
 * Which origins this installation trusts beyond its own address. No list
 * shipped with a deploy holds the next customer's provider: an administrator
 * holding `sso:manage` registering one is what trusts it (ADR-117 §5).
 */

/**
 * The bare origin of one address, or nothing where it has none. Never the
 * value verbatim: the engine compares a discovery URL as
 * `entry === origin(url)`, and an issuer usually carries a path.
 */
function findOrigins(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "") return [];
  try {
    const origin = new URL(trimmed).origin;
    // A urn parses, but its origin is opaque — the literal string "null",
    // which trusts nothing and reads as a bug in a list.
    return origin === "null" ? [] : [origin];
  } catch {
    return [];
  }
}

/** An operator's list, which people write with commas, spaces or both. */
function originsIn(list: string | undefined): string[] {
  if (!list) return [];
  return list.split(/[\s,]+/).flatMap(findOrigins);
}

export function resolveTrustedOrigins({
  baseUrl,
  publicBaseUrl,
  trustedIdpOrigins,
  idpSimulatorUrl,
  registeredIssuers = [],
  isProduction,
}: {
  /** Where this instance believes it is served. */
  baseUrl: string;
  /** Behind a reverse proxy this is the external address while {@link baseUrl}
   *  may be the internal one. Both are us. */
  publicBaseUrl: string | undefined;
  /** `SSO_TRUSTED_IDP_ORIGINS`: an operator's own allowlist, honoured
   *  everywhere. The way on for a provider inside a private network. */
  trustedIdpOrigins: string | undefined;
  /** `LANGWATCH_IDPSIM_URL`: the simulator a worktree runs. Honoured outside
   *  production only — it signs whatever it is asked to sign. */
  idpSimulatorUrl: string | undefined;
  /** Issuers of the connections this installation holds, scoped to the one
   *  this request names: the same list gates the `Origin` header and
   *  `callbackURL`, so the whole set would make one tenant's registered
   *  origin a redirect target for every other tenant. */
  registeredIssuers?: string[];
  isProduction: boolean;
}): string[] {
  const origins = [
    baseUrl,
    ...(publicBaseUrl && publicBaseUrl !== baseUrl ? [publicBaseUrl] : []),
    ...registeredIssuers.flatMap(findOrigins),
    ...originsIn(trustedIdpOrigins),
    ...(isProduction ? [] : originsIn(idpSimulatorUrl)),
  ];

  // Deduped in order, so the first entries stay this deployment's own address
  // and an operator reading the resolved list sees it the way they wrote it.
  return [...new Set(origins)];
}
