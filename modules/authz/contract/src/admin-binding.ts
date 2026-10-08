import type { AuthzBindingForSynthesis } from "./authz.queries.ts";

/** The organisation role that administers the organisation. */
const ORGANIZATION_ADMIN_ROLE = "ADMIN";

/**
 * Whether an organisation-scoped ADMIN binding makes this person an
 * administrator of the organisation. The binding is authoritative where
 * present, so a stale MEMBER membership row cannot shadow it.
 */
export function holdsOrganizationAdminBinding({
  bindings,
  organizationId,
}: {
  bindings: readonly AuthzBindingForSynthesis[];
  organizationId: string;
}): boolean {
  return bindings.some(
    (binding) =>
      binding.organizationId === organizationId &&
      binding.scopeType === "ORGANIZATION" &&
      binding.role === ORGANIZATION_ADMIN_ROLE,
  );
}
