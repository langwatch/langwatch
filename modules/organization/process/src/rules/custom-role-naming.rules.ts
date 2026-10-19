/**
 * Whether a role name is one an organization defined for itself — a naming convention on a
 * stored string, not an entitlement, so every writer that persists a role string reads it.
 */
export function isCustomRole(role: string): boolean {
  return role.startsWith("custom:");
}
