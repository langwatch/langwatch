import type { LedgerActor } from "@langwatch/actor";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import {
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  ROLE_KIND,
  RoleDuplicateNameError,
  RoleNotFoundError,
  type Role,
  type RoleCreate,
  type RoleUpdate,
} from "@langwatch/role-contract";
import { nanoid } from "nanoid";
import { RoleRepository } from "../role.repository";

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

const toRole = (value: unknown): Role => {
  const role = value as StoredRole;
  return {
    id: role.id,
    organizationId: role.organizationId,
    name: role.name,
    description: role.description,
    permissions: asPermissions(role.permissions),
    kind: role.kind === ROLE_KIND.SYSTEM_API_KEY ? ROLE_KIND.SYSTEM_API_KEY : ROLE_KIND.CUSTOM,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
};

export class PrismaRoleRepository extends RoleRepository {
  private constructor(
    private readonly prisma: PrismaClient,
    private readonly writer: AuthzGrantsService,
    private readonly access: AuthzService,
    private readonly newBindingId: () => string,
  ) {
    super();
  }

  static create(options: {
    database: object;
    writer: AuthzGrantsService;
    access: AuthzService;
    newBindingId: () => string;
  }): PrismaRoleRepository {
    return new PrismaRoleRepository(
      options.database as PrismaClient,
      options.writer,
      options.access,
      options.newBindingId,
    );
  }

  async findAll(organizationId: string): Promise<Role[]> {
    const roles = await this.access.listUserCreatedRoles({ organizationId });
    return roles.map((role) => toRole({ ...role, kind: ROLE_KIND.CUSTOM }));
  }

  async tryFindById(roleId: string): Promise<Role | null> {
    const row = await this.prisma.customRole.findUnique({
      where: { id: roleId },
    });
    return row ? toRole(row) : null;
  }

  async tryFindCustomByIdInOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role | null> {
    const row = await this.prisma.customRole.findFirst({
      where: {
        id: input.roleId,
        organizationId: input.organizationId,
        kind: ROLE_KIND.CUSTOM,
      },
    });
    return row ? toRole(row) : null;
  }

  tryFindTeam(teamId: string): Promise<{ organizationId: string } | null> {
    return this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
  }

  async hasTeamMember(input: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<boolean> {
    const bindings = await this.access.listUserBindings({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    return bindings.some(
      (binding) =>
        binding.scopeType === RoleBindingScopeType.TEAM && binding.scopeId === input.teamId,
    );
  }

  async tryFindUserBinding(input: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<{ customRoleId: string } | null> {
    const bindings = await this.access.listUserBindings({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    const binding = bindings.find(
      (candidate) =>
        candidate.scopeType === RoleBindingScopeType.TEAM &&
        candidate.scopeId === input.teamId &&
        candidate.customRoleId !== null,
    );
    return binding?.customRoleId ? { customRoleId: binding.customRoleId } : null;
  }

  findAssignable(roleIds: string[], organizationId: string): Promise<Array<{ id: string }>> {
    return this.prisma.customRole.findMany({
      where: {
        id: { in: roleIds },
        organizationId,
        kind: ROLE_KIND.CUSTOM,
      },
      select: { id: true },
    });
  }

  async findAssignablePermissions(
    roleIds: string[],
    organizationId: string,
  ): Promise<Array<{ id: string; permissions: string[] }>> {
    const rows = await this.prisma.customRole.findMany({
      where: {
        id: { in: roleIds },
        organizationId,
        kind: ROLE_KIND.CUSTOM,
      },
      select: { id: true, permissions: true },
    });
    return rows.map((row) => ({
      id: row.id,
      permissions: asPermissions(row.permissions),
    }));
  }

  async countRoleBindings(input: { roleId: string; organizationId: string }): Promise<number> {
    const bindings = await this.access.listOrganizationBindings({
      organizationId: input.organizationId,
    });
    return bindings.filter((binding) => binding.customRoleId === input.roleId).length;
  }

  countAssignedUsers(roleId: string): Promise<number> {
    return this.prisma.teamUser.count({ where: { assignedRoleId: roleId } });
  }

  private async assertNameFree(
    organizationId: string,
    name: string,
    exceptRoleId: string | null,
  ): Promise<void> {
    const row = await this.prisma.customRole.findUnique({
      where: { organizationId_name: { organizationId, name } },
      select: { id: true },
    });
    if (row && row.id !== exceptRoleId) throw new RoleDuplicateNameError();
  }

  async create(input: { role: RoleCreate; actor: LedgerActor }): Promise<Role> {
    await this.assertNameFree(input.role.organizationId, input.role.name, null);
    const roleId = nanoid();
    await this.writer.defineRole({
      organizationId: input.role.organizationId,
      roleId,
      name: input.role.name,
      ...(input.role.description != null ? { description: input.role.description } : {}),
      permissions: input.role.permissions,
      kind: ROLE_KIND.CUSTOM,
      actor: input.actor,
    });
    const now = new Date();
    return {
      id: roleId,
      organizationId: input.role.organizationId,
      name: input.role.name,
      description: input.role.description ?? null,
      permissions: input.role.permissions,
      kind: ROLE_KIND.CUSTOM,
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(input: { roleId: string; changes: RoleUpdate; actor: LedgerActor }): Promise<Role> {
    const existing = await this.prisma.customRole.findUnique({
      where: { id: input.roleId },
    });
    if (!existing) throw new RoleNotFoundError(input.roleId);
    const current = toRole(existing);
    const name = input.changes.name ?? current.name;
    if (name !== current.name) {
      await this.assertNameFree(current.organizationId, name, current.id);
    }
    const description =
      input.changes.description !== undefined ? input.changes.description : current.description;
    const permissions = input.changes.permissions ?? current.permissions;
    await this.writer.defineRole({
      organizationId: current.organizationId,
      roleId: current.id,
      name,
      ...(description !== null ? { description } : {}),
      permissions,
      kind: current.kind,
      actor: input.actor,
    });
    return { ...current, name, description, permissions, updatedAt: new Date() };
  }

  async deleteIfUnused(input: {
    roleId: string;
    organizationId: string;
    actor: LedgerActor;
    awaitProjection?: boolean;
  }): Promise<boolean> {
    const [role, bindings, assignedUsers] = await Promise.all([
      this.prisma.customRole.findFirst({
        where: {
          id: input.roleId,
          organizationId: input.organizationId,
        },
        select: { id: true },
      }),
      this.countRoleBindings({
        organizationId: input.organizationId,
        roleId: input.roleId,
      }),
      this.prisma.teamUser.count({ where: { assignedRoleId: input.roleId } }),
    ]);
    if (!role || bindings > 0 || assignedUsers > 0) return false;
    await this.writer.deleteRole({
      organizationId: input.organizationId,
      roleId: input.roleId,
      actor: input.actor,
      awaitProjection: input.awaitProjection,
    });
    return true;
  }

  private async replaceTeamGrant(input: {
    userId: string;
    teamId: string;
    customRoleId: string | null;
    actor: LedgerActor;
  }): Promise<void> {
    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: input.teamId },
      select: { organizationId: true },
    });
    const bindings = await this.access.listUserBindings({
      userId: input.userId,
      organizationId: team.organizationId,
    });
    const existing = bindings.find(
      (binding) =>
        binding.userId === input.userId &&
        binding.scopeType === RoleBindingScopeType.TEAM &&
        binding.scopeId === input.teamId,
    );
    if (existing) {
      await this.writer.changeBindingRole({
        organizationId: team.organizationId,
        bindingId: existing.id,
        role: input.customRoleId ? TeamUserRole.CUSTOM : TeamUserRole.VIEWER,
        customRoleId: input.customRoleId,
        actor: input.actor,
      });
      return;
    }
    await this.writer.attachBindings({
      organizationId: team.organizationId,
      bindings: [
        {
          bindingId: this.newBindingId(),
          principal: { userId: input.userId },
          role: input.customRoleId ? TeamUserRole.CUSTOM : TeamUserRole.VIEWER,
          customRoleId: input.customRoleId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: input.teamId,
        },
      ],
      actor: input.actor,
      onDuplicate: "skip",
    });
  }

  assign(input: {
    userId: string;
    teamId: string;
    customRoleId: string;
    actor: LedgerActor;
  }): Promise<void> {
    return this.replaceTeamGrant(input);
  }

  remove(input: { userId: string; teamId: string; actor: LedgerActor }): Promise<void> {
    return this.replaceTeamGrant({ ...input, customRoleId: null });
  }

  async isExclusiveToApiKey(input: { roleId: string; apiKeyId: string }): Promise<boolean> {
    const role = await this.tryFindById(input.roleId);
    if (!role) return false;
    const [bindings, assignedUsers] = await Promise.all([
      this.access.listOrganizationBindings({
        organizationId: role.organizationId,
      }),
      this.countAssignedUsers(input.roleId),
    ]);
    return (
      assignedUsers === 0 &&
      bindings
        .filter((binding) => binding.customRoleId === input.roleId)
        .every((binding) => binding.apiKeyId === input.apiKeyId)
    );
  }

  async removeExclusiveApiKeyRoles(input: {
    roleIds: string[];
    apiKeyId: string;
    organizationId: string;
    actor: LedgerActor;
    awaitProjection?: boolean;
  }): Promise<void> {
    if (input.roleIds.length === 0) return;
    await this.writer.revokeBindingsWhere({
      organizationId: input.organizationId,
      where: {
        apiKeyId: input.apiKeyId,
        customRoleId: { in: input.roleIds },
      },
      actor: input.actor,
      reason: "api key credential retired",
    });
    for (const roleId of input.roleIds) {
      const [bindings, assignedUsers] = await Promise.all([
        this.access.listOrganizationBindings({
          organizationId: input.organizationId,
        }),
        this.prisma.teamUser.count({ where: { assignedRoleId: roleId } }),
      ]);
      const otherBindings = bindings.filter(
        (binding) => binding.customRoleId === roleId && binding.apiKeyId !== input.apiKeyId,
      ).length;
      if (otherBindings > 0 || assignedUsers > 0) continue;
      await this.writer.deleteRole({
        organizationId: input.organizationId,
        roleId,
        actor: input.actor,
        awaitProjection: input.awaitProjection,
      });
    }
  }
}
