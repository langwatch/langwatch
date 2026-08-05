import { OrganizationUserRole } from "@prisma/client";
import {
  type OrgRoleOption,
  orgRoleOptions,
} from "../settings/OrganizationUserRoleField";

/**
 * Returns the organization role options available to the current user.
 * Non-admin users cannot assign the ADMIN role when inviting members.
 */
export function getOrgRoleOptionsForUser({
  isAdmin,
}: {
  isAdmin: boolean;
}): OrgRoleOption[] {
  if (isAdmin) {
    return orgRoleOptions;
  }

  return orgRoleOptions.filter(
    (option) => option.value !== OrganizationUserRole.ADMIN,
  );
}
