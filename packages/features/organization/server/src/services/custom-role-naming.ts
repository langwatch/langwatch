/**
 * Whether a role name is one an organization defined for itself.
 *
 * A naming convention on a stored string rather than an entitlement, which is
 * why it travels with the membership half instead of with the Enterprise plan
 * gate. Every writer that persists a role string reads it, so a second spelling
 * of the prefix would write bindings the resolver does not recognise.
 */
export function isCustomRole(role: string): boolean {
  return role.startsWith("custom:");
}
