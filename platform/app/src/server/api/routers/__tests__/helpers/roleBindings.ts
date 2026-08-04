/**
 * RoleBinding fixtures for router integration suites.
 *
 * Not a `*.test.ts` file on purpose — it holds no assertions, only the setup.
 *
 * WHY THIS EXISTS. Creating an `OrganizationUser` with `role: ADMIN` does not
 * make the caller an admin. `hasOrganizationPermission` gives every org member
 * only MEMBER's base bag as a floor and resolves everything above it through
 * ORGANIZATION-scoped `RoleBinding` rows; the legacy `TeamUser` union
 * deliberately cannot confer `organization:*` (ADR-021). A suite that creates
 * only the membership rows is therefore refused at the permission gate, before
 * reaching whatever guard it was written to exercise — which is exactly how
 * several suites came to assert nothing while still reporting green (#6327).
 */
import type { PrismaClient } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";

/**
 * Grants a user real admin rights in an organization, and optionally in one
 * team within it, by creating the bindings the RBAC resolver actually reads.
 *
 * Pass `teamId` when the suite calls a team-scoped procedure
 * (`checkTeamPermission`); omit it for org-only surfaces.
 */
export async function grantOrganizationAdmin({
  prisma,
  organizationId,
  userId,
  teamId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  teamId?: string;
}): Promise<void> {
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });

  if (teamId) {
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });
  }
}

/**
 * Binds a custom role to a user at TEAM scope.
 *
 * The legacy `TeamUser.assignedRoleId` column is NOT enough: the guards read
 * the assignment through `getUserCustomRoleBinding`, a RoleBinding lookup. With
 * only the legacy column set, a caller's old permissions read as undefined and
 * `getRoleChangeType` sees no role change at all — so the limit under test is
 * never asserted and the procedure returns success.
 */
export async function bindCustomRoleToTeam({
  prisma,
  organizationId,
  userId,
  teamId,
  customRoleId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  teamId: string;
  customRoleId: string;
}): Promise<void> {
  await prisma.roleBinding.deleteMany({
    where: {
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId,
      role: TeamUserRole.CUSTOM,
      customRoleId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });
}
