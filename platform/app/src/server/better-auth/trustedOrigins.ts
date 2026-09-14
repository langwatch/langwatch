/**
 * Which origins this installation trusts, beyond its own address.
 *
 * WHY THIS EXISTS. Before the SSO engine will fetch an issuer's discovery
 * document it checks the issuer's origin against this list, and refuses an
 * unlisted one with `discovery_untrusted_origin`. The refusal is correct in
 * the shape the check was designed for — a single-tenant app with one known
 * identity provider, where an unlisted issuer means somebody is pointing the
 * server at an address it should not fetch.
 *
 * IT IS THE WRONG SHAPE FOR US, AND A STATIC LIST CANNOT BE MADE RIGHT.
 * Every customer brings their own identity provider. There is no set of
 * origins we could ship, or an operator could maintain, that contains the
 * next enterprise's Okta tenant — so a static allowlist does not make
 * registration safe, it makes registration impossible, and the symptom is a
 * customer whose test sign-in fails with a message about a configuration
 * file they have never seen and cannot edit.
 *
 * SO THE LIST IS DERIVED FROM WHAT CUSTOMERS REGISTERED. An organization
 * administrator holding `sso:manage` registering an issuer IS the declaration
 * that this installation may talk to it: it is an authenticated, audited,
 * permission-gated act by the only person entitled to decide who signs their
 * company in. The origins of the connections we hold are therefore the
 * trusted set, and it grows and shrinks with them rather than with a deploy.
 *
 * WHAT STILL PROTECTS US. Registration is the gate, not this list: only an
 * administrator of that organization can add an issuer, our own registration
 * checks the issuer answers before a fact is written, and the engine's
 * separate non-routable-host refusal still stands for anything an operator
 * has not explicitly vouched for.
 *
 * TWO STATIC WAYS ON REMAIN, for the cases no registered connection covers:
 *
 *   SSO_TRUSTED_IDP_ORIGINS  an operator's deliberate allowlist. Honoured
 *                            everywhere, production included. This is the
 *                            escape hatch for an identity provider inside a
 *                            private network, whose address the engine would
 *                            otherwise refuse as non-routable.
 *
 *   LANGWATCH_IDPSIM_URL     the simulator haven starts for this worktree.
 *                            Honoured OUTSIDE production only. It is a
 *                            development fixture that signs whatever it is
 *                            asked to sign, and a production installation
 *                            that trusted one would be trusting an oracle.
 *
 * Framework-free and total, so the decision can be pinned by a test that
 * boots nothing. The registered issuers are READ elsewhere and passed in.
 */

/**
 * The origin of an address, or null if it is not one.
 *
 * Entries are normalised to bare origins rather than kept verbatim: the
 * engine compares an https discovery URL to each entry as
 * `entry === origin(url)`, so an entry carrying a path — which is what an
 * issuer usually is — would match nothing at all.
 */
function originOf(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/** An operator's list, which people write with commas, spaces or both. */
function originsIn(list: string | undefined): string[] {
  if (!list) return [];
  return list
    .split(/[\s,]+/)
    .map(originOf)
    .filter((origin): origin is string => origin !== null);
}

export function resolveTrustedOrigins({
  nextAuthUrl,
  baseHost,
  trustedIdpOrigins,
  idpSimulatorUrl,
  registeredIssuers = [],
  isProduction,
}: {
  nextAuthUrl: string;
  /** Behind a reverse proxy this is the external address while
   *  `nextAuthUrl` may be the internal one. Both are us. */
  baseHost: string | undefined;
  /** `SSO_TRUSTED_IDP_ORIGINS`, an operator's own allowlist. */
  trustedIdpOrigins: string | undefined;
  /** `LANGWATCH_IDPSIM_URL`, written by haven for this worktree. */
  idpSimulatorUrl: string | undefined;
  /** Issuers of the single sign-on connections this installation holds.
   *  Each one was registered by an administrator of the organization it
   *  belongs to, which is what makes it trusted. */
  registeredIssuers?: string[];
  isProduction: boolean;
}): string[] {
  const origins = [
    nextAuthUrl,
    ...(baseHost && baseHost !== nextAuthUrl ? [baseHost] : []),
    ...registeredIssuers
      .map(originOf)
      .filter((origin): origin is string => origin !== null),
    ...originsIn(trustedIdpOrigins),
    ...(isProduction ? [] : originsIn(idpSimulatorUrl)),
  ];

  // Deduped in order, so the first two entries stay the app's own address
  // and an operator reading the resolved list sees it the way they wrote it.
  return [...new Set(origins)];
}
