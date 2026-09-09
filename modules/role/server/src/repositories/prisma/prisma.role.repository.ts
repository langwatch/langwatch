import { PrismaRepository } from "@langwatch/prisma-client";
import { ROLE_KIND, type Role } from "@langwatch/role-contract";
import type { RoleRepository } from "../role.repository.ts";

type StoredRole = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: unknown;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
};

const asPermissions = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((permission): permission is string => typeof permission === "string")
    : [];

const toRole = (role: StoredRole): Role => ({
  id: role.id,
  organizationId: role.organizationId,
  name: role.name,
  description: role.description,
  permissions: asPermissions(role.permissions),
  kind: role.kind === ROLE_KIND.SYSTEM_API_KEY ? ROLE_KIND.SYSTEM_API_KEY : ROLE_KIND.CUSTOM,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

export class PrismaRoleRepository
  extends PrismaRepository.for("CustomRole", "TeamUser")
  implements RoleRepository
{
  static readonly create = this.factory((prisma) => new PrismaRoleRepository(prisma));

  async findById(input: { roleId: string }): Promise<Role | undefined> {
    const row = await this.prisma.customRole.findUnique({ where: { id: input.roleId } });

    return row ? toRole(row as StoredRole) : void 0;
  }

  async findCustomInOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role | undefined> {
    const row = await this.prisma.customRole.findFirst({
      where: {
        id: input.roleId,
        organizationId: input.organizationId,
        kind: ROLE_KIND.CUSTOM,
      },
    });

    return row ? toRole(row as StoredRole) : void 0;
  }

  async findByName(input: {
    organizationId: string;
    name: string;
  }): Promise<{ id: string } | undefined> {
    const row = await this.prisma.customRole.findUnique({
      where: {
        organizationId_name: { organizationId: input.organizationId, name: input.name },
      },
      select: { id: true },
    });

    return row ?? void 0;
  }

  findAssignable(input: { roleIds: string[]; organizationId: string }): Promise<{ id: string }[]> {
    return this.prisma.customRole.findMany({
      where: {
        id: { in: input.roleIds },
        organizationId: input.organizationId,
        kind: ROLE_KIND.CUSTOM,
      },
      select: { id: true },
    });
  }

  countAssignedUsers(input: { roleId: string }): Promise<number> {
    return this.prisma.teamUser.count({ where: { assignedRoleId: input.roleId } });
  }
}
