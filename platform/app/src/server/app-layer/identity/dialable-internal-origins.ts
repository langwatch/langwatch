/**
 * The origins we will dial even though they answer inside a private network.
 *
 * The egress guard refuses a private address because the string it is dialing
 * came off a form, and a form that reaches our own network is a port scanner
 * with a nice screen. That rule is right for every address nobody named in
 * advance — and wrong for the two that somebody did:
 *
 *   SSO_TRUSTED_IDP_ORIGINS  an identity provider living inside the
 *                            customer's own network. Honoured everywhere,
 *                            production included, because an operator who
 *                            runs their provider on a private address has
 *                            said so deliberately and has no public one to
 *                            give us instead.
 *
 *   LANGWATCH_IDPSIM_URL     the simulator haven starts for this worktree.
 *                            Honoured OUTSIDE production only. It signs
 *                            whatever it is asked to sign, so an
 *                            installation that dialed one would be
 *                            registering an oracle as an identity provider.
 *
 * BOTH ARE THE ENGINE'S LISTS ALREADY. `resolveTrustedOrigins` reads the same
 * two variables under the same production rule, so better-auth will complete
 * a sign-in through either address. Registration refused them, which left an
 * installation able to sign in through a provider it was not allowed to
 * register — the ceremony and the sign-in disagreeing about one address.
 * Reading the same values here is what makes them agree.
 *
 * VOUCHING IS PER ORIGIN AND DOES NOT TRAVEL. The guard checks each hop
 * against this list separately, so a vouched origin that redirects into
 * `169.254.169.254` is refused at the second hop like anything else. That is
 * the property that keeps an allowlist from becoming a tunnel.
 *
 * Framework-free and total, so the decision is pinned by a test that boots
 * nothing — and deliberately NOT an env read of its own: the composition root
 * passes the values in, the way every other environment read in the identity
 * runtime is passed.
 */

/**
 * The origin of an address, or null if it is not one.
 *
 * Normalised to bare origins because that is what a hop is compared against:
 * an entry carrying the path an issuer usually has would match nothing.
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

export function resolveDialableInternalOrigins({
  trustedIdpOrigins,
  idpSimulatorUrl,
  isProduction,
}: {
  /** `SSO_TRUSTED_IDP_ORIGINS`, an operator's own allowlist. */
  trustedIdpOrigins: string | undefined;
  /** `LANGWATCH_IDPSIM_URL`, written by haven for this worktree. */
  idpSimulatorUrl: string | undefined;
  isProduction: boolean;
}): string[] {
  const origins = [
    ...originsIn(trustedIdpOrigins),
    ...(isProduction ? [] : originsIn(idpSimulatorUrl)),
  ];

  return [...new Set(origins)];
}
