import type {
  AuthzMigrationRepository,
  ExistingTeamBinding,
  LegacyTeamRow,
  OrganizationScopeInventory,
  TeamBindingWrite,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * ADR-092 stage B - storage for the in-place TeamUser backfill. Facts and
 * batch writes only; equivalence, parity and finalization live in
 * `TeamUserBackfillMigration` (@langwatch/authz-server).
 */
export class PrismaAuthzMigrationRepository implements AuthzMigrationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findLegacyTeamRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyTeamRow[]> {
    // Archived teams included on purpose: their rows still feed the legacy
    // fallback, so parity has to account for them too.
    const rows = await this.prisma.teamUser.findMany({
      where: { team: { organizationId } },
      select: { userId: true, teamId: true, role: true, assignedRoleId: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      teamId: row.teamId,
      role: row.role,
      customRoleId: row.assignedRoleId,
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
