import {
  organizationRoleSchema,
  roleBindingScopeTypeSchema,
  teamUserRoleSchema,
  type OrganizationRole,
  type RoleBindingScopeType,
} from "@langwatch/authz-contract";
import { z } from "zod";
import {
  AuthzBindingRepository,
  type AuthzBindingScopeRow,
  type AuthzManagedBindingRow,
  type AuthzUserGroupRow,
} from "../authz-binding.repository";

type Delegate = {
  count(args: unknown): Promise<number>;
  findFirst(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
};

const scopeOrganizationRowSchema = z.object({ id: z.string(), name: z.string() }).strict();
const scopeTeamRowSchema = scopeOrganizationRowSchema.extend({ isPersonal: z.boolean() }).strict();
const scopeProjectRowSchema = scopeTeamRowSchema
  .extend({ team: z.object({ isPersonal: z.boolean(), name: z.string() }).strict() })
  .strict();
const groupMemberRowSchema = z.object({ groupId: z.string(), userId: z.string() }).strict();
const userGroupRowSchema = z
  .object({
    groupId: z.string(),
    group: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        scimSource: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const organizationRoleRowSchema = z.object({ role: organizationRoleSchema }).strict();
const managedBindingRowSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    userId: z.string().nullable(),
    groupId: z.string().nullable(),
    apiKeyId: z.string().nullable(),
    role: teamUserRoleSchema,
    customRoleId: z.string().nullable(),
    scopeType: roleBindingScopeTypeSchema,
    scopeId: z.string(),
  })
  .strict();
const assignableRoleRowSchema = z.object({ id: z.string(), permissions: z.unknown() }).strict();

export type AuthzBindingDatabase = {
  apiKey: Delegate;
  customRole: Delegate;
  group: Delegate;
  groupMembership: Delegate;
  organization: Delegate;
  organizationUser: Delegate;
  project: Delegate;
  roleBinding: Delegate;
  team: Delegate;
  teamUser: Delegate;
};

export class PrismaAuthzBindingRepository extends AuthzBindingRepository {
  static create(database: AuthzBindingDatabase): PrismaAuthzBindingRepository {
    return new PrismaAuthzBindingRepository(database);
  }

  private constructor(private readonly database: AuthzBindingDatabase) {
    super();
  }

  async hasBindingsForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const count = await this.database.roleBinding.count({
      where: { organizationId, userId },
    });
    return count > 0;
  }

  async hasLegacySharedTeamMembership({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const count = await this.database.teamUser.count({
      where: { userId, team: { organizationId, isPersonal: false } },
    });
    return count > 0;
  }

  async findScopeRows({
    organizationId,
    scopes,
  }: {
    organizationId: string;
    scopes: ReadonlyArray<{
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
  }): Promise<AuthzBindingScopeRow[]> {
    const idsOfType = (scopeType: RoleBindingScopeType) => [
      ...new Set(
        scopes.filter((scope) => scope.scopeType === scopeType).map((scope) => scope.scopeId),
      ),
    ];
    const organizationIds = idsOfType("ORGANIZATION").filter((id) => id === organizationId);
    const teamIds = idsOfType("TEAM");
    const projectIds = idsOfType("PROJECT");

    const [organizations, teams, projects] = await Promise.all([
      organizationIds.length > 0
        ? this.database.organization.findMany({
            where: { id: { in: organizationIds } },
            select: { id: true, name: true },
          })
        : [],
      teamIds.length > 0
        ? this.database.team.findMany({
            where: { id: { in: teamIds }, organizationId },
            select: { id: true, name: true, isPersonal: true },
          })
        : [],
      projectIds.length > 0
        ? this.database.project.findMany({
            where: { id: { in: projectIds }, team: { organizationId } },
            select: {
              id: true,
              name: true,
              isPersonal: true,
              team: { select: { isPersonal: true, name: true } },
            },
          })
        : [],
    ]);

    const organizationRows = z.array(scopeOrganizationRowSchema).parse(organizations);
    const teamRows = z.array(scopeTeamRowSchema).parse(teams);
    const projectRows = z.array(scopeProjectRowSchema).parse(projects);

    return [
      ...organizationRows.map((row): AuthzBindingScopeRow => ({
        type: "ORGANIZATION",
        id: row.id,
        name: row.name,
        personalWorkspaceName: null,
      })),
      ...teamRows.map((row): AuthzBindingScopeRow => ({
        type: "TEAM",
        id: row.id,
        name: row.name,
        personalWorkspaceName: row.isPersonal ? row.name : null,
      })),
      ...projectRows.map((row): AuthzBindingScopeRow => ({
        type: "PROJECT",
        id: row.id,
        name: row.name,
        personalWorkspaceName: row.isPersonal || row.team.isPersonal ? row.team.name : null,
      })),
    ];
  }

  async findGroupMembers({
    organizationId,
    groupIds,
  }: {
    organizationId: string;
    groupIds: readonly string[];
  }): Promise<Array<{ groupId: string; userId: string }>> {
    if (groupIds.length === 0) {
      return [];
    }

    const rows = await this.database.groupMembership.findMany({
      where: {
        groupId: { in: [...groupIds] },
        group: { organizationId },
        user: { orgMemberships: { some: { organizationId } } },
      },
      select: { groupId: true, userId: true },
    });

    return z.array(groupMemberRowSchema).parse(rows);
  }

  async findUserGroups({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzUserGroupRow[]> {
    const rows = await this.database.groupMembership.findMany({
      where: { userId, group: { organizationId } },
      select: {
        groupId: true,
        group: {
          select: { id: true, name: true, slug: true, scimSource: true },
        },
      },
    });

    return z.array(userGroupRowSchema).parse(rows);
  }

  async tryFindOrganizationRole({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationRole | null> {
    const storedMembership = await this.database.organizationUser.findFirst({
      where: { organizationId, userId },
      select: { role: true },
    });
    const membership = organizationRoleRowSchema.nullable().parse(storedMembership);

    return membership?.role ?? null;
  }

  async isGroupInOrganization({
    organizationId,
    groupId,
  }: {
    organizationId: string;
    groupId: string;
  }): Promise<boolean> {
    const group = await this.database.group.findFirst({
      where: { id: groupId, organizationId },
      select: { id: true },
    });
    return group !== null;
  }

  async isApiKeyInOrganization({
    organizationId,
    apiKeyId,
  }: {
    organizationId: string;
    apiKeyId: string;
  }): Promise<boolean> {
    const apiKey = await this.database.apiKey.findFirst({
      where: { id: apiKeyId, organizationId },
      select: { id: true },
    });
    return apiKey !== null;
  }

  async tryFindBinding({
    organizationId,
    bindingId,
  }: {
    organizationId: string;
    bindingId: string;
  }): Promise<AuthzManagedBindingRow | null> {
    const row = await this.database.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        groupId: true,
        apiKeyId: true,
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });

    return managedBindingRowSchema.nullable().parse(row);
  }

  async findDirectUserBindings({
    organizationId,
    userId,
    bindingIds,
  }: {
    organizationId: string;
    userId: string;
    bindingIds: readonly string[];
  }): Promise<AuthzManagedBindingRow[]> {
    if (bindingIds.length === 0) {
      return [];
    }

    const rows = await this.database.roleBinding.findMany({
      where: {
        id: { in: [...bindingIds] },
        organizationId,
        userId,
        groupId: null,
      },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        groupId: true,
        apiKeyId: true,
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });

    return z.array(managedBindingRowSchema).parse(rows);
  }

  async findAssignableRoles({
    organizationId,
    roleIds,
  }: {
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<Array<{ id: string; permissions: unknown }>> {
    if (roleIds.length === 0) {
      return [];
    }

    const rows = await this.database.customRole.findMany({
      where: {
        id: { in: [...roleIds] },
        organizationId,
        kind: "custom",
      },
      select: { id: true, permissions: true },
    });

    return z.array(assignableRoleRowSchema).parse(rows);
  }
}
