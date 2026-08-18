import type {
  AuthzCutoverRepository,
  AuthzGenesisRepository,
  AuthzMigrationRepository,
  ExistingTeamBinding,
  ExternalMemberFact,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  OrganizationScopeInventory,
  PlatformAdminUserFact,
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  RoleHeadRow,
  ShareLinkFactRow,
  TeamBindingWrite,
} from "@langwatch/authz-server";
import type { TenantMigrationStatus } from "@langwatch/system-migrations";
import type { PrismaClient } from "~/generated/prisma/client";
import { queryCutoverOnEngine } from "../cutover-gate";

/**
 * ADR-092 stage B - storage for the in-place TeamUser backfill, the genesis
 * import and the per-organization cutover. Facts and batch writes only;
 * equivalence, parity and finalization live in the migrations themselves
 * (@langwatch/authz-server).
 */
export class PrismaAuthzMigrationRepository
  implements
    AuthzMigrationRepository,
    AuthzGenesisRepository,
    AuthzCutoverRepository
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

  async findGenesisOwnedGrantHeadIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.grant.findMany({
      where: { organizationId, source: "genesis-import" },
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

  async findMigrationTenantStatuses({
    tenantId,
    migrationNames,
  }: {
    tenantId: string;
    migrationNames: readonly string[];
  }): Promise<Record<string, TenantMigrationStatus | null>> {
    const rows = await this.prisma.systemMigrationTenantState.findMany({
      where: { tenantId, migrationName: { in: [...migrationNames] } },
      select: { migrationName: true, status: true },
    });
    // `status` is a plain Prisma string column (no DB enum) - wider than the
    // union the port is pinned to, same reasoning as ledger-write-gate.ts's
    // own read of this table. The cast is on this map's values, not on the
    // port's declared type, so a rename of the union still catches every
    // caller.
    const stored = new Map(
      rows.map((row) => [
        row.migrationName,
        row.status as TenantMigrationStatus,
      ]),
    );
    // Every asked-for name is answered, so the caller reads "never ran" as
    // the null it is rather than as a missing key.
    return Object.fromEntries(
      migrationNames.map((name) => [name, stored.get(name) ?? null]),
    );
  }

  async findShareLinkRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ShareLinkFactRow[]> {
    // ShareLink's tenancy is its project, and the multitenancy guard holds
    // every query on it to a projectId (ADR-057) - a relation walk through
    // the team would be rejected. So the organization's projects are
    // resolved first and the links are read by that finite set.
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    if (projects.length === 0) return [];
    const rows = await this.prisma.shareLink.findMany({
      where: { projectId: { in: projects.map((project) => project.id) } },
      select: {
        id: true,
        token: true,
        resourceType: true,
        resourceId: true,
        projectId: true,
        userId: true,
        visibility: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      token: row.token,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      projectId: row.projectId,
      userId: row.userId,
      visibility: row.visibility,
      expiresAtMs: row.expiresAt?.getTime() ?? null,
      maxViews: row.maxViews,
      viewCount: row.viewCount,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  /**
   * The view budgets, handed over rather than restarted. `skipDuplicates` is
   * the whole safety argument: a row that already exists is a budget the
   * ledger has been counting since the first seed, and overwriting it would
   * refund views a customer already spent.
   */
  async seedResourceGrantUsage({
    organizationId,
    seeds,
  }: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void> {
    if (seeds.length === 0) return;
    await this.prisma.grantUsage.createMany({
      data: seeds.map((seed) => ({
        grantId: seed.grantId,
        organizationId,
        projectId: seed.projectId,
        viewCount: seed.viewCount,
      })),
      skipDuplicates: true,
    });
  }

  async findExternalMemberFacts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ExternalMemberFact[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: { organizationId, role: "EXTERNAL" },
      select: { userId: true, createdAt: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findProjectCredentialFacts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ProjectCredentialFact[]> {
    // `Project.apiKey` is a non-null column, so in practice every project
    // carries the legacy credential; the empty-string guard is what keeps
    // "has a credential" the predicate rather than "is a project", should a
    // future project be minted without one.
    const rows = await this.prisma.project.findMany({
      where: { team: { organizationId }, apiKey: { not: "" } },
      select: { id: true, createdAt: true },
    });
    return rows.map((row) => ({
      projectId: row.id,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findUsersByEmail({
    emails,
  }: {
    emails: readonly string[];
  }): Promise<PlatformAdminUserFact[]> {
    if (emails.length === 0) return [];
    // Case-insensitive, exactly as the live admin check compares: a stored
    // address that differs only in case is the same operator.
    const rows = await this.prisma.user.findMany({
      where: {
        OR: emails.map((email) => ({
          email: { equals: email, mode: "insensitive" as const },
        })),
      },
      select: { id: true, email: true, createdAt: true },
    });
    return rows.flatMap((row) =>
      row.email === null
        ? []
        : [
            {
              userId: row.id,
              email: row.email.toLowerCase(),
              createdAtMs: row.createdAt.getTime(),
            },
          ],
    );
  }

  async findResourceGrantRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ResourceGrantRow[]> {
    const rows = await this.prisma.grant.findMany({
      where: { organizationId, scopeType: "RESOURCE" },
      select: {
        id: true,
        token: true,
        resourceKind: true,
        scopeId: true,
        projectId: true,
        principalType: true,
        principalId: true,
        expiresAt: true,
        maxViews: true,
      },
    });
    if (rows.length === 0) return [];
    // The view budget lives on its own table (decision 22), so the proof's
    // "field for field" needs a second read to see it. No usage row means no
    // view has been counted, which is exactly zero.
    const usages = await this.prisma.grantUsage.findMany({
      where: { organizationId, grantId: { in: rows.map((row) => row.id) } },
      select: { grantId: true, viewCount: true },
    });
    const viewCounts = new Map(
      usages.map((usage) => [usage.grantId, usage.viewCount]),
    );
    return rows.map((row) => ({
      grantId: row.id,
      token: row.token,
      resourceKind: row.resourceKind,
      resourceId: row.scopeId,
      projectId: row.projectId,
      principalType: row.principalType,
      principalId: row.principalId,
      expiresAtMs: row.expiresAt?.getTime() ?? null,
      maxViews: row.maxViews,
      viewCount: viewCounts.get(row.id) ?? 0,
    }));
  }

  async findOrganizationMemberIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  async findOrganizationApiKeyIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    // Revoked keys are excluded: they authorize nothing on either head, so
    // sweeping them would only spend round trips.
    const rows = await this.prisma.apiKey.findMany({
      where: { organizationId, revokedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** The same query the request-path gate's own cache miss runs
   *  (cutover-gate.ts's `queryCutoverOnEngine`) - one predicate, so the
   *  migration awaiting its own flip and the gate serving it can never
   *  drift onto different answers. */
  async findCutoverOnEngine({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<boolean> {
    return queryCutoverOnEngine({ prisma: this.prisma, organizationId });
  }
}
