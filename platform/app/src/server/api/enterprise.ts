/**
 * Whether a role name is one an organization defined for itself.
 *
 * The Enterprise plan gate that used to live here — the refusal, the
 * capability vocabulary, and the REST and tRPC middleware — is
 * `@langwatch/enterprise-plan-gate`. Custom roles are a naming convention on
 * a stored string rather than an entitlement, so this stayed.
 */
export function isCustomRole(role: string): boolean {
  return role.startsWith("custom:");
}
