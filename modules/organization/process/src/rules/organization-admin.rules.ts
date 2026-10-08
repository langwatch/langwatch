import {
  holdsOrganizationAdminBinding,
  type AuthzBindingForSynthesis,
} from "@langwatch/authz-contract";

/** The organisation role that administers the organisation. */
const ORGANIZATION_ADMIN_ROLE = "ADMIN";

/** The role of someone with no live membership: a service key, a stranger, a disabled member. */
export const NO_ORGANIZATION_ROLE = "NONE";

/**
 * The person's role in the organisation as every listing decides it: an
 * organisation ADMIN binding outranks the membership row. Decides which
 * project kinds a listing carries.
 */
export function organizationRoleOf({
  bindings,
  organizationId,
  membership,
}: {
  bindings: readonly AuthzBindingForSynthesis[];
  organizationId: string;
  membership: Readonly<{ role: string; disabledAt: unknown }> | undefined;
}): string {
  if (holdsOrganizationAdminBinding({ bindings, organizationId })) return ORGANIZATION_ADMIN_ROLE;
  if (!membership || membership.disabledAt) return NO_ORGANIZATION_ROLE;

  return membership.role;
}
