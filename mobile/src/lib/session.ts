/**
 * The stored session shape and the rules about its lifetime.
 *
 * Kept free of any React Native import so the expiry arithmetic — the part that
 * decides whether a request goes out with a dead credential — is testable
 * without a device.
 */

export interface StoredSession {
  /** The instance this session belongs to, as an origin. */
  instance: string;
  accessToken: string;
  refreshToken: string;
  /** Unix milliseconds. */
  accessTokenExpiresAt: number;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  organizationName: string | null;
}

/**
 * Refresh a little before the token actually dies, so a request that takes a
 * moment to reach the server does not arrive holding an expired credential and
 * pay for a retry.
 */
export const REFRESH_MARGIN_MS = 60_000;

export function isAccessTokenExpired(
  session: Pick<StoredSession, "accessTokenExpiresAt">,
  now: number = Date.now(),
  marginMs: number = REFRESH_MARGIN_MS,
): boolean {
  return session.accessTokenExpiresAt - marginMs <= now;
}

export function sessionDisplayName(session: StoredSession): string {
  return session.userName ?? session.userEmail ?? "Signed in";
}

/**
 * Parse whatever came out of the keystore. Anything unrecognisable is treated as
 * "not signed in" rather than throwing on launch: a corrupt entry should send
 * the operator to the sign-in screen, not crash the app before it draws.
 */
export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const candidate = parsed as Partial<StoredSession>;
  if (
    typeof candidate.instance !== "string" ||
    typeof candidate.accessToken !== "string" ||
    typeof candidate.refreshToken !== "string" ||
    typeof candidate.accessTokenExpiresAt !== "number" ||
    typeof candidate.userId !== "string"
  ) {
    return null;
  }

  return {
    instance: candidate.instance,
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    accessTokenExpiresAt: candidate.accessTokenExpiresAt,
    userId: candidate.userId,
    userEmail: candidate.userEmail ?? null,
    userName: candidate.userName ?? null,
    organizationName: candidate.organizationName ?? null,
  };
}
