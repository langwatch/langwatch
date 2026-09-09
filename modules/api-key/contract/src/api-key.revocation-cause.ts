/**
 * Why an API key was revoked, stored on the row beside `revokedAt`.
 *
 * - `user`: a person revoked it, from the API-keys page or the REST API.
 * - `rotation`: a hard-cut mint replaced it with a new key.
 * - `cap`: the personal ingest-key cap retired it as the least recently used.
 *
 * The CLI reads the cause to decide whether a dead ingest key may be
 * re-minted on the device that held it. A rotation or a cap eviction is the
 * platform's own doing and the device repairs itself; a key a person revoked
 * stays dead until that person sets the device up again.
 */
export const API_KEY_REVOCATION_CAUSES = ["user", "rotation", "cap"] as const;

export type ApiKeyRevocationCause = (typeof API_KEY_REVOCATION_CAUSES)[number];

export function isApiKeyRevocationCause(
  value: string | null | undefined,
): value is ApiKeyRevocationCause {
  return (API_KEY_REVOCATION_CAUSES as readonly string[]).includes(value ?? "");
}
