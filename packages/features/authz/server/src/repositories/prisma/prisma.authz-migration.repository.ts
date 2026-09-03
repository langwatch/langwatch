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
  $executeRawUnsafe?(query: string, ...values: unknown[]): Promise<number>;
}>;

const BUDGET_SEED_CHUNK = 5_000;

/** Prisma-compatible adapter; generated Prisma values never cross this seam. */
export class PrismaAuthzMigrationRepository extends AuthzMigrationRepository {
  static create(database: AuthzMigrationDatabase): PrismaAuthzMigrationRepository {
    return new PrismaAuthzMigrationRepository(database);
  }

  private constructor(private readonly database: AuthzMigrationDatabase) {
    super();
  }

  async tryFindOrganizationCreatedAtMs({
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

  async findGrantHeadRows({ organizationId }: { organizationId: string }): Promise<GrantHeadRow[]> {
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

  async findRoleHeads({ organizationId }: { organizationId: string }): Promise<RoleHeadRow[]> {
    // Deleted heads remain in the parity proof as tombstones.
    const rows = await this.database.role.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        kind: true,
        deletedAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      permissions: row.permissions,
      kind: row.kind,
      deleted: row.deletedAt !== null,
    }));
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
   * ONE guarded upsert per chunk: a missing row is inserted at the seeded
   * count, an existing one raised only where the seed is strictly higher.
   * That refund guard lives in the UPDATE itself, so a consume landing
   * mid-flight cannot be walked back by a filter resolved in an earlier
   * SELECT.
   *
   * One statement per chunk rather than one per row because this rides every
   * pass: the previous shape paid a round trip per share link, and on a
   * converged organization every one matched nothing. The organization that
   * found it never finished a pass at all, so never recorded a status.
   *
   * `organizationId` and `projectId` are matched rather than overwritten: a
   * row that disagrees about where it lives is not this seed's to move.
   */
  async seedResourceGrantUsage({
    organizationId,
    seeds,
  }: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void> {
    if (seeds.length === 0) return;
    if (!this.database.$executeRawUnsafe) {
      await this.seedResourceGrantUsageWithoutRaw({ organizationId, seeds });
      return;
    }

    for (let offset = 0; offset < seeds.length; offset += BUDGET_SEED_CHUNK) {
      await this.raiseGrantUsageBudgets({
        organizationId,
        seeds: seeds.slice(offset, offset + BUDGET_SEED_CHUNK),
      });
    }
  }

  private async seedResourceGrantUsageWithoutRaw({
    organizationId,
    seeds,
  }: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void> {
    await this.database.grantUsage.createMany({
      data: seeds.map((seed) => ({
        grantId: seed.grantId,
        organizationId,
        projectId: seed.projectId,
        viewCount: seed.viewCount,
      })),
      skipDuplicates: true,
    });

    for (const seed of seeds) {
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
        if (!PrismaAuthzMigrationRepository.isRecordNotFound(error)) {
          throw error;
        }
      }
    }
  }

  private raiseGrantUsageBudgets({
    organizationId,
    seeds,
  }: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<number> {
    const values = seeds.flatMap((seed) => [
      seed.grantId,
      organizationId,
      seed.projectId,
      seed.viewCount,
    ]);
    const rows = seeds.map((_, index) => {
      const first = index * 4 + 1;
      return `($${first}, $${first + 1}, $${first + 2}, $${first + 3}, NOW())`;
    });
    const statement = `
      INSERT INTO "GrantUsage" (
        "grantId", "organizationId", "projectId", "viewCount", "updatedAt"
      ) VALUES ${rows.join(", ")}
      ON CONFLICT ("grantId") DO UPDATE SET
        "viewCount" = EXCLUDED."viewCount",
        "updatedAt" = NOW()
      WHERE "GrantUsage"."viewCount" < EXCLUDED."viewCount"
        AND "GrantUsage"."organizationId" = EXCLUDED."organizationId"
        AND "GrantUsage"."projectId" = EXCLUDED."projectId"
    `;
    const execute = this.database.$executeRawUnsafe;
    if (!execute) {
      throw new Error("Authz migration database does not support raw budget upserts");
    }
    return execute.call(this.database, statement, ...values);
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
      //
      // Read BY ORGANIZATION, not by naming every grant: `GrantUsage` is
      // organization-indexed and organization-scoped, so both spellings select
      // the same budgets, but naming them binds a parameter per grant against
      // Postgres' 65535 ceiling - which an organization with 428k share links
      // clears on its own. The lookup below is by id, so extra rows are free.
      where: { organizationId },
      select: { grantId: true, viewCount: true },
    });
    const viewCounts = new Map(usages.map((usage) => [usage.grantId, usage.viewCount]));
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
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
  }
}
