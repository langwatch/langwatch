/**
 * The WebAuthn relying party this deployment answers as.
 *
 * WHY THE EXTERNAL ADDRESS, AND WHY THIS IS NOT THE PLUGIN'S DEFAULT. A
 * passkey is bound to a relying party id at the moment it is created, and the
 * browser will only ever offer it back to a page served from that same
 * domain — that binding is the whole reason a passkey cannot be phished. The
 * plugin derives its own rpID from better-auth's `baseURL`, which here is
 * `NEXTAUTH_URL`, and behind a reverse proxy that is the INTERNAL address
 * while `BASE_HOST` is the one a person's browser actually typed. On a
 * preview host or any proxied deployment the two differ — `NEXTAUTH_URL` can
 * still be the committed `http://localhost:5560` default — so the ceremony
 * was built for the relying party "localhost", the browser signed for the
 * public host, and SimpleWebAuthn refused every assertion on the RP-id-hash
 * mismatch. The plugin's catch-all turned that into
 * `identity_passkey_not_recognized`, which reads as "we do not know this
 * credential" when the truth is "we asked the wrong question". So the
 * relying party is resolved from the address the browser sees, the same
 * external-before-internal rule `trustedOrigins.ts` already applies.
 *
 * Framework-free and total, so the decision can be pinned by a test that
 * boots nothing. Returning null rather than throwing is deliberate: a
 * deployment with neither address set is a build-time or misconfigured one,
 * and letting the plugin keep its own default there is a worse passkey
 * experience, not a dead process.
 */
export function passkeyRelyingParty({
  baseHost,
  nextAuthUrl,
}: {
  /** The address a browser reaches this installation on. */
  baseHost?: string | null;
  /** better-auth's own `baseURL`, which behind a proxy may be internal. */
  nextAuthUrl?: string | null;
}): { rpID: string; origin: string } | null {
  for (const candidate of [baseHost, nextAuthUrl]) {
    const url = parsed(candidate);
    if (!url) continue;

    // The relying party id is a bare domain: it carries no scheme and no
    // port, and a port left on it is not a domain the browser will match.
    // The expected origin is the opposite — the port is part of what the
    // browser signed, so it stays, and everything after it goes.
    return { rpID: url.hostname, origin: url.origin };
  }

  return null;
}

function parsed(value: string | null | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}
