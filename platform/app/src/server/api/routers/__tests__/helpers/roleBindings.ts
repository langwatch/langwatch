/** RoleBinding fixtures for router integration suites. */
import { roleFactToRow } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { parseCustomRolePermissions } from "~/server/app-layer/authz/custom-role-permissions";
import { seedRoleBinding } from "~/test-utils/authz-seeds";

/** Grant a user organization admin rights and, when requested, team admin rights. */
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
  await seedRoleBinding(prisma, {
    organizationId,
    userId,
    role: TeamUserRole.ADMIN,
    scopeType: RoleBindingScopeType.ORGANIZATION,
    scopeId: organizationId,
  });

  if (teamId) {
    await seedRoleBinding(prisma, {
      organizationId,
      userId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    });
  }
}

/** Bind a projected custom role to a user at TEAM scope. */
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
  const customRole = await prisma.customRole.findUnique({
    where: { id: customRoleId },
    select: {
      organizationId: true,
      name: true,
      description: true,
      permissions: true,
      createdAt: true,
    },
  });
  if (customRole == null || customRole.organizationId !== organizationId) {
    throw new Error(`Custom role ${customRoleId} is not in the organization`);
  }
  const existingRole = await prisma.role.findUnique({
    where: { id: customRoleId },
    select: { organizationId: true, deletedAt: true },
  });
  if (
    existingRole?.organizationId !== undefined &&
    existingRole.organizationId !== organizationId
  ) {
    throw new Error(
      `Custom role ${customRoleId} is projected in another organization`,
    );
  }
  if (existingRole?.deletedAt != null) {
    throw new Error(`Custom role ${customRoleId} has been deleted`);
  }
  const permissions = parseCustomRolePermissions({
    customRoleId,
    permissions: customRole.permissions,
  });
  await prisma.role.upsert({
    where: { id: customRoleId },
    create: roleFactToRow({
      organizationId,
      role: {
        roleId: customRoleId,
        name: customRole.name,
        description: customRole.description ?? undefined,
        permissions,
        kind: "custom",
        occurredAtMs: customRole.createdAt.getTime(),
      },
    }),
    update: {
      name: customRole.name,
      description: customRole.description,
      permissions,
      kind: "custom",
      occurredAt: customRole.createdAt,
    },
  });
  const previousBindings = await prisma.roleBinding.findMany({
    where: {
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
    select: { id: true },
  });
  const previousBindingIds = previousBindings.map(({ id }) => id);
  if (previousBindingIds.length > 0) {
    await prisma.grant.updateMany({
      where: { id: { in: previousBindingIds }, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: "fixture_replaced",
      },
    });
  }
  await prisma.roleBinding.deleteMany({
    where: {
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });
  await seedRoleBinding(prisma, {
    organizationId,
    userId,
    role: TeamUserRole.CUSTOM,
    customRoleId,
    scopeType: RoleBindingScopeType.TEAM,
    scopeId: teamId,
  });
}
