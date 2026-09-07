/**
 * Why an API key was revoked, stored on the row beside `revokedAt`.
 *
 * - `user`: a person revoked it, from the API-keys page, the REST API or the
 *   devices tab.
 * - `rotation`: a mint replaced it: a re-login from the same device replacing
 *   the previous CLI login key, or a rotate from the personal tile.
 * - `session`: the CLI login key it was parented to was revoked, so the key
 *   went with its session.
 * - `expired`: its session ran out, at a refused refresh or in the hourly
 *   sweep over elapsed login keys.
 * - `offboarded`: the person's membership of the organization ended, so the
 *   session was retired at its next refresh rather than at its own expiry.
 * - `cap`: the retired per-tool cap revoked it. Kept so old rows still parse.
 *
 * The CLI reads the cause to decide whether a dead ingest key may be
 * re-minted on the device that held it. Only a key a person revoked stays
 * dead until that person sets the device up again; every other cause is the
 * platform's own doing and the device repairs itself under its current
 * session.
 */
export const API_KEY_REVOCATION_CAUSES = [
  "user",
  "rotation",
  "session",
  "expired",
  "offboarded",
  "cap",
] as const;

export type ApiKeyRevocationCause = (typeof API_KEY_REVOCATION_CAUSES)[number];

export function isApiKeyRevocationCause(
  value: string | null | undefined,
): value is ApiKeyRevocationCause {
  return (API_KEY_REVOCATION_CAUSES as readonly string[]).includes(value ?? "");
}
