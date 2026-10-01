/**
 * Why an API key was revoked, stored on the row beside `revokedAt`. The CLI reads it to decide
 * whether a dead ingest key may be re-minted: only `user` stays dead until that person re-sets
 * up the device; every other cause self-repairs under the current session.
 */
export const API_KEY_REVOCATION_CAUSES = [
  /** A person revoked it, from the API-keys page, the REST API or the devices tab. */
  "user",
  /**
   * A mint replaced it: a re-login replacing the previous CLI login key, or a personal-tile
   * rotate. Ingest keys under a re-logged-in session carry it too, since a device may re-mint
   * under the session that replaced theirs.
   */
  "rotation",
  /** The CLI login key it was parented to was revoked (a logout, or the devices tab). */
  "session",
  /** Its session ran out, at a refused refresh or in the hourly sweep over elapsed login keys. */
  "expired",
  /** The person's organization membership ended, so the session was retired early. */
  "offboarded",
  /** The retired per-tool cap revoked it. Kept so old rows still parse. */
  "cap",
] as const;

export type ApiKeyRevocationCause = (typeof API_KEY_REVOCATION_CAUSES)[number];

export function isApiKeyRevocationCause(
  value: string | null | undefined,
): value is ApiKeyRevocationCause {
  return (API_KEY_REVOCATION_CAUSES as readonly string[]).includes(value ?? "");
}
