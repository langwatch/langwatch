import type {
  AuthzGenesisRepository,
  AuthzMigrationRepository,
  ExistingTeamBinding,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  OrganizationScopeInventory,
  RoleHeadRow,
  TeamBindingWrite,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * ADR-092 stage B - storage for the in-place TeamUser backfill. Facts and
 * batch writes only; equivalence, parity and finalization live in
 * `TeamUserBackfillMigration` (@langwatch/authz-server).
 */
export class PrismaAuthzMigrationRepository
  implements AuthzMigrationRepository, AuthzGenesisRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findOrganizationCreatedAtMs({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { createdAt: true },
    });
    return organization?.createdAt.getTime() ?? null;
  }

  async findLegacyBindingRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyBindingRow[]> {
    const rows = await this.prisma.roleBinding.findMany({
      where: { organizationId },
      select: {
        id: true,
        userId: true,
        groupId: true,
        apiKeyId: true,
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      groupId: row.groupId,
      apiKeyId: row.apiKeyId,
      role: row.role,
      customRoleId: row.customRoleId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findLegacyRoleRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyRoleRow[]> {
    const rows = await this.prisma.customRole.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        kind: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      permissions: row.permissions,
      kind: row.kind,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findOrganizationMembers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationMemberFact[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true, role: true, createdAt: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findGrantHeadIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.grant.findMany({
      where: { organizationId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findRoleHeads({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<RoleHeadRow[]> {
    const rows = await this.prisma.role.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        kind: true,
      },
    });
    return rows;
  }

  async findLegacyTeamRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyTeamRow[]> {
    // Archived teams included on purpose: their rows still feed the legacy
    // fallback, so parity has to account for them too.
    const rows = await this.prisma.teamUser.findMany({
      where: { team: { organizationId } },
      select: {
        userId: true,
        teamId: true,
        role: true,
        assignedRoleId: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      userId: row.userId,
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.assignedRoleId,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findExistingTeamBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ExistingTeamBinding[]> {
    const rows = await this.prisma.roleBinding.findMany({
      where: { organizationId, scopeType: "TEAM", userId: { not: null } },
      select: { userId: true, scopeId: true, role: true, customRoleId: true },
    });
    return rows.flatMap((row) =>
      row.userId === null
        ? []
        : [
            {
              userId: row.userId,
              teamId: row.scopeId,
              role: row.role,
              customRoleId: row.customRoleId,
            },
          ],
    );
  }

  async createTeamBindings(rows: TeamBindingWrite[]): Promise<number> {
    // The partial unique indexes decide identity; skipDuplicates makes the
    // batch idempotent under them.
    const result = await this.prisma.roleBinding.createMany({
      data: rows.map((row) => ({
        id: row.bindingId,
        organizationId: row.organizationId,
        userId: row.userId,
        role: row.role,
        customRoleId: row.customRoleId,
        scopeType: "TEAM",
        scopeId: row.teamId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async findOrganizationScopeInventory({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationScopeInventory> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, projects: { select: { id: true } } },
    });
    return {
      teamIds: teams.map((team) => team.id),
      projects: teams.flatMap((team) =>
        team.projects.map((project) => ({ id: project.id, teamId: team.id })),
      ),
    };
  }
}
