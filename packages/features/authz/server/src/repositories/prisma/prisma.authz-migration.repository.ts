import type {
  ExternalMemberFact,
  GrantHeadRow,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  RoleHeadRow,
  ShareLinkFactRow,
} from "../authz-migration.repository";
import { AuthzMigrationRepository } from "../authz-migration.repository";

type DatabaseRow = Record<string, any>;

interface FindUniqueDelegate {
  findUnique(args: unknown): Promise<DatabaseRow | null>;
}

interface FindManyDelegate {
  findMany(args: unknown): Promise<DatabaseRow[]>;
}

interface GrantUsageDelegate extends FindManyDelegate {
  createMany(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
}

export type AuthzMigrationDatabase = Readonly<{
  organization: FindUniqueDelegate;
  roleBinding: FindManyDelegate;
  customRole: FindManyDelegate;
  organizationUser: FindManyDelegate;
  grant: FindManyDelegate;
  role: FindManyDelegate;
  teamUser: FindManyDelegate;
  groupMembership: FindManyDelegate;
  project: FindManyDelegate;
  shareLink: FindManyDelegate;
  grantUsage: GrantUsageDelegate;
}>;

const BUDGET_RAISE_CONCURRENCY = 25;

/** Prisma-compatible adapter; generated Prisma values never cross this seam. */
export class PrismaAuthzMigrationRepository extends AuthzMigrationRepository {
  static create(
    database: AuthzMigrationDatabase,
  ): PrismaAuthzMigrationRepository {
    return new PrismaAuthzMigrationRepository(database);
  }

  private constructor(private readonly database: AuthzMigrationDatabase) {
    super();
  }

  async findOrganizationCreatedAtMs({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    const organization = await this.database.organization.findUnique({
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
    const rows = await this.database.roleBinding.findMany({
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
    const rows = await this.database.customRole.findMany({
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
    const rows = await this.database.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true, role: true, createdAt: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  async findGrantHeadRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GrantHeadRow[]> {
    const rows = await this.database.grant.findMany({
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
    const rows = await this.database.role.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        kind: true,
      },
    });
    return rows as RoleHeadRow[];
  }

  async findLegacyTeamRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyTeamRow[]> {
    // Archived teams included on purpose: their rows still feed the legacy
    // fallback, so parity has to account for them too.
    const rows = await this.database.teamUser.findMany({
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

  /** Every (userId, groupId) membership in the organization — what lets the
   *  migration mirror the legacy fallback's suppression predicate, which
   *  counts bindings held THROUGH a group as bindings the user holds. */
  async findGroupMemberships({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Array<{ userId: string; groupId: string }>> {
    return (await this.database.groupMembership.findMany({
      where: { group: { organizationId } },
      select: { userId: true, groupId: true },
    })) as Array<{ userId: string; groupId: string }>;
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
    const projects = await this.database.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    if (projects.length === 0) return [];
    const rows = await this.database.shareLink.findMany({
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
    await this.database.grantUsage.createMany({
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
      await this.database.grantUsage.update({
        where: {
          grantId: seed.grantId,
          organizationId,
          projectId: seed.projectId,
          viewCount: { lt: seed.viewCount },
        },
        data: { viewCount: seed.viewCount },
      });
    } catch (error) {
      if (PrismaAuthzMigrationRepository.isRecordNotFound(error)) {
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
    const rows = await this.database.organizationUser.findMany({
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
    const rows = await this.database.project.findMany({
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
    const rows = await this.database.grant.findMany({
      // Live rows only: this read serves the ADR-110 proof, and a revoked
      // link is a deny already applied, not an extra to reconcile.
      where: { organizationId, scopeType: "RESOURCE", revokedAt: null },
      select: {
        id: true,
        source: true,
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
    const usages = await this.database.grantUsage.findMany({
      where: { organizationId, grantId: { in: rows.map((row) => row.id) } },
      select: { grantId: true, viewCount: true },
    });
    const viewCounts = new Map(
      usages.map((usage) => [usage.grantId, usage.viewCount]),
    );
    return rows.map((row) => ({
      grantId: row.id,
      source: row.source,
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

  private static isRecordNotFound(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2025"
    );
  }
}
