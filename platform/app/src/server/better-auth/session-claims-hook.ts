import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:better-auth:session-claims");

/** What a sign-in on this path proved, and which identifier it was. */
export interface SessionClaimsPort {
  claimsForMint(args: { userId: string; path: string }): Promise<{
    identifierId: string | null;
    amr: readonly string[];
  }>;
}

/**
 * What better-auth writes onto a session row it is about to create (D06).
 *
 * Bound to `databaseHooks.session.create.before`, which is the one place that
 * sees BOTH the endpoint that is minting the session and the row before it
 * exists. The endpoint is what says what was proved - a password sign-in, a
 * two-step challenge answered, a passkey, a federated callback - and the row
 * is where the answer has to land.
 *
 * Three properties, and all three are the point:
 *
 *   - it can only ADD columns. The hook returns `{ data }`, which better-auth
 *     merges into the row; there is no branch here that returns `false`, so
 *     nothing about recording what a session proved can refuse a sign-in.
 *   - a failure records nothing rather than failing. A session that recorded
 *     nothing is an ordinary session - every one minted before this shipped
 *     is one - so degrading to it costs the person nothing.
 *   - it asks about the SESSION'S OWN user id, never the caller's. An
 *     impersonation mints no session (it writes claims onto the operator's
 *     existing one), so there is no case where these two differ.
 */
export async function sessionClaimsData({
  userId,
  path,
  claims: source,
}: {
  userId: string | undefined;
  path: string | undefined;
  claims: SessionClaimsPort;
}): Promise<
  { data: { identifierId: string | null; amr: string[] } } | undefined
> {
  if (!userId || !path) return undefined;
  try {
    const claims = await source.claimsForMint({ userId, path });
    if (claims.identifierId === null && claims.amr.length === 0) {
      // Nothing to say. Returning no data leaves the row's own defaults,
      // which are exactly the "recorded nothing" values.
      return undefined;
    }
    return {
      data: { identifierId: claims.identifierId, amr: [...claims.amr] },
    };
  } catch (error) {
    logger.warn(
      { error, path },
      "could not resolve what this sign-in proved; the session records nothing, which is the pre-D06 behaviour and ends nothing",
    );
    return undefined;
  }
}
