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
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  RoleHeadRow,
  ShareLinkFactRow,
  TeamBindingWrite,
} from "@langwatch/authz-server";
import type { TenantMigrationStatus } from "@langwatch/system-migrations";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type { GrantHeadRow } from "../authz-engine.migration";
import { queryOrganizationOnAuthzEngine } from "../engine-gate";

/**
 * How many guarded budget raises are in flight at once while seeding an
 * organization's view budgets. Bounded so an organization with thousands of
 * share links cannot open thousands of concurrent connections.
 */
const BUDGET_RAISE_CONCURRENCY = 25;

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

  /** Every non-resource Grant head row, revoked included — the ADR-110
   *  proof needs both directions: a live row to compare and a revoked one to
   *  recognize as already denied. Resource rows have their own read
   *  (`findResourceGrantRows`), which carries the tier's extra columns. */
  async findGrantHeadRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GrantHeadRow[]> {
    const rows = await this.prisma.grant.findMany({
      where: { organizationId, scopeType: { not: "RESOURCE" } },
      select: {
        id: true,
        principalType: true,
        principalId: true,
        roleKey: true,
        legacyRole: true,
        source: true,
        scopeType: true,
        scopeId: true,
        revokedAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      principalType: row.principalType,
      principalId: row.principalId,
      roleKey: row.roleKey,
      legacyRole: row.legacyRole,
      source: row.source,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      revoked: row.revokedAt !== null,
    }));
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
    // union the port is pinned to, same reasoning as engine-gate.ts's
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
   * The view budgets, handed over rather than restarted - and RAISED on a
   * re-run, never lowered (the port's own contract; decision 22).
   *
   * Two writes, each safe on its own terms. The `createMany` with
   * `skipDuplicates` lands missing rows without touching existing ones. The
   * per-row guarded update then raises a row the legacy path has outgrown:
   * while an organization is held, views keep landing on
   * `ShareLink.viewCount`, and a usage row seeded on an earlier pass would
   * otherwise sit permanently below it - wedging the import proof, which
   * compares the two counts exactly. The `viewCount: { lt: ... }` predicate
   * is the refund guard: a row already at or above the seeded count (a view
   * consumed since the seed) is left exactly as it is.
   *
   * The raise is `update` on the filtered unique, not `updateMany`, for the
   * same reason the share consume paths are: the query compiler keeps a
   * filtered-unique `update`'s full WHERE on the UPDATE statement itself,
   * while `updateMany` resolves the filter in a prior SELECT - a consume
   * landing between the two would be silently walked back. A raise the guard
   * refuses surfaces as P2025 and is swallowed as the no-op it means. Raises
   * run concurrently in bounded batches; each targets a distinct row, so
   * they cannot contend with each other.
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
    for (
      let offset = 0;
      offset < seeds.length;
      offset += BUDGET_RAISE_CONCURRENCY
    ) {
      await Promise.all(
        seeds
          .slice(offset, offset + BUDGET_RAISE_CONCURRENCY)
          .map((seed) => this.raiseGrantUsageBudget({ organizationId, seed })),
      );
    }
  }

  private async raiseGrantUsageBudget({
    organizationId,
    seed,
  }: {
    organizationId: string;
    seed: ResourceGrantUsageSeed;
  }): Promise<void> {
    try {
      await this.prisma.grantUsage.update({
        where: {
          grantId: seed.grantId,
          organizationId,
          projectId: seed.projectId,
          viewCount: { lt: seed.viewCount },
        },
        data: { viewCount: seed.viewCount },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return;
      }
      throw error;
    }
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

  async findResourceGrantRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ResourceGrantRow[]> {
    const rows = await this.prisma.grant.findMany({
      // Live rows only: this read serves the ADR-110 proof, and a revoked
      // link is a deny already applied, not an extra to reconcile.
      where: { organizationId, scopeType: "RESOURCE", revokedAt: null },
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
    // Ordered because the parity proof derives diff order - and, from it,
    // its command id - from this iteration order (the port's own doc).
    const rows = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
      orderBy: { userId: "asc" },
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
      // Ordered for the same reason the member read is: the proof's identity
      // depends on iteration order.
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }

  /** The same query the request-path gate's own cache miss runs
   *  (engine-gate.ts's `queryOrganizationOnAuthzEngine`) - one predicate, so the
   *  migration awaiting its own flip and the gate serving it can never
   *  drift onto different answers. */
  async findCutoverOnEngine({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<boolean> {
    return queryOrganizationOnAuthzEngine({
      prisma: this.prisma,
      organizationId,
    });
  }
}
