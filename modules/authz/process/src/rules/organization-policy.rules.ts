import type { AuthzOrganizationPolicy } from "@langwatch/authz-contract";

/** What an organisation that never changed a setting holds. */
export function defaultOrganizationPolicy({
  organizationId,
}: {
  organizationId: string;
}): AuthzOrganizationPolicy {
  return {
    organizationId,
    braidsOrganizationAdminsOnly: false,
    updatedByUserId: null,
    updatedAtMs: null,
  };
}
