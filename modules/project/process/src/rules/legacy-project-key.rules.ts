/**
 * The project's key column is required and unique, so a revoked legacy key is
 * stored as a value that no caller holds and no door resolves to a project.
 */
export const REVOKED_LEGACY_KEY_PREFIX = "lw-revoked-" as const;

export function isLegacyKeyRevoked(apiKey: string): boolean {
  return apiKey.startsWith(REVOKED_LEGACY_KEY_PREFIX);
}
