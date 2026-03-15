import { OrganizationUserRole } from "@prisma/client";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * Guard hook that determines whether the current user is a lite member.
 *
 * Lite members are users with the EXTERNAL organization role.
 * They can navigate all pages freely but cannot create, edit, or
 * delete resources. Mutations are blocked server-side and the
 * global error handler opens a restriction modal.
 *
 * @returns `isLiteMember` - true if the user has the EXTERNAL organization role
 */
export function useLiteMemberGuard(): {
  isLiteMember: boolean;
} {
  const { organizationRole } = useOrganizationTeamProject();

  const isLiteMember = organizationRole === OrganizationUserRole.EXTERNAL;

  return { isLiteMember };
}
