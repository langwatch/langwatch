// Why a key was revoked: user, rotation, cap. CLI uses this to decide if dead ingest key may be
// re-minted. Platform-initiated revocation (rotation/cap) is repairable; user-revocation is
// permanent.
export const API_KEY_REVOCATION_CAUSES = ["user", "rotation", "cap"] as const;

export type ApiKeyRevocationCause = (typeof API_KEY_REVOCATION_CAUSES)[number];

export function isApiKeyRevocationCause(
  value: string | null | undefined,
): value is ApiKeyRevocationCause {
  return (API_KEY_REVOCATION_CAUSES as readonly string[]).includes(value ?? "");
}
