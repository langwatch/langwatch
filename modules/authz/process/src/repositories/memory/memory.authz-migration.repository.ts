import {
  AuthzMigrationRepository,
  type ExternalMemberFact,
  type GrantHeadRow,
  type LegacyBindingRow,
  type LegacyRoleRow,
  type LegacyTeamRow,
  type OrganizationMemberFact,
  type ProjectCredentialFact,
  type ResourceGrantRow,
  type ResourceGrantUsageSeed,
  type RoleHeadRow,
  type ShareLinkFactRow,
} from "../authz-migration.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The ADR-110 import's reads over the memory tables, with the Prisma adapter's predicates. */
export class MemoryAuthzMigrationRepository extends AuthzMigrationRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzMigrationRepository {
    return new MemoryAuthzMigrationRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findOrganizationCreatedAtMs({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    return this.memory.organizations.get(organizationId)?.createdAt.epochMilliseconds ?? null;
  }

  async findLegacyBindingRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyBindingRow[]> {
    return this.memory.bindings
      .filter((row) => row.organizationId === organizationId)
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        groupId: row.groupId,
        apiKeyId: row.apiKeyId,
        role: row.role,
        customRoleId: row.customRoleId,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        createdAtMs: row.createdAt.epochMilliseconds,
      }));
  }

  async findLegacyRoleRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyRoleRow[]> {
    return this.memory.roles
      .filter((row) => row.organizationId === organizationId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        permissions: copyPermissions(row.permissions),
        kind: row.kind,
        createdAtMs: row.createdAt.epochMilliseconds,
      }));
  }

  async findOrganizationMembers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationMemberFact[]> {
    return this.membershipsOf(organizationId).map(({ userId, row }) => ({
      userId,
      role: row.role,
      createdAtMs: row.createdAt.epochMilliseconds,
      membershipStamp: row.membershipStamp,
    }));
  }

  async findGrantHeadRows({ organizationId }: { organizationId: string }): Promise<GrantHeadRow[]> {
    return this.memory.grants
      .filter((row) => row.organizationId === organizationId && row.scopeType !== "RESOURCE")
      .map((row) => ({
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

  /** Deleted heads remain in the parity proof as tombstones. */
  async findRoleHeads({ organizationId }: { organizationId: string }): Promise<RoleHeadRow[]> {
    return this.memory.roleHeads
      .filter((row) => row.organizationId === organizationId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        permissions: [...row.permissions],
        kind: row.kind,
        deleted: row.deletedAt !== null,
      }));
  }

  /** Archived teams included on purpose: their rows still feed the legacy fallback. */
  async findLegacyTeamRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<LegacyTeamRow[]> {
    return this.memory.teamMemberships
      .filter((row) => this.memory.isTeamIn(row.teamId, organizationId))
      .map((row) => ({
        userId: row.userId,
        teamId: row.teamId,
        role: row.role,
        customRoleId: row.assignedRoleId,
        createdAtMs: row.createdAt.epochMilliseconds,
      }));
  }

  async findGroupMemberships({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ userId: string; groupId: string }[]> {
    return this.memory.groupMemberships
      .filter((row) => this.memory.isGroupIn(row.groupId, organizationId))
      .map(({ userId, groupId }) => ({ userId, groupId }));
  }

  /** ShareLink's tenancy is its project, so the organization's projects bound the read. */
  async findShareLinkRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ShareLinkFactRow[]> {
    const projectIds = new Set(this.projectsOf(organizationId).map((project) => project.id));
    return this.memory.shareLinks
      .filter((row) => projectIds.has(row.projectId))
      .map((row) => ({
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
        createdAtMs: row.createdAt.epochMilliseconds,
      }));
  }

  /** Insert each budget, or raise one the same grant holds in the same tenancy; never lower. */
  async seedResourceGrantUsage({
    organizationId,
    seeds,
  }: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void> {
    for (const seed of seeds) {
      const usage = this.memory.grantUsages.find((row) => row.grantId === seed.grantId);
      if (!usage) {
        this.memory.grantUsages.push({ ...seed, organizationId });
        continue;
      }
      if (
        usage.viewCount < seed.viewCount &&
        usage.organizationId === organizationId &&
        usage.projectId === seed.projectId
      ) {
        usage.viewCount = seed.viewCount;
      }
    }
  }

  async findExternalMemberFacts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ExternalMemberFact[]> {
    return this.membershipsOf(organizationId)
      .filter(({ row }) => row.role === "EXTERNAL")
      .map(({ userId, row }) => ({ userId, createdAtMs: row.createdAt.epochMilliseconds }));
  }

  /** A project with an empty legacy credential is a project, not a credential. */
  async findProjectCredentialFacts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ProjectCredentialFact[]> {
    return this.projectsOf(organizationId)
      .filter((project) => project.apiKey !== "")
      .map((project) => ({
        projectId: project.id,
        createdAtMs: project.createdAt.epochMilliseconds,
      }));
  }

  /** Live rows only: a revoked link is a deny already applied, not an extra to reconcile. */
  async findResourceGrantRows({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ResourceGrantRow[]> {
    const viewCounts = new Map(
      this.memory.grantUsages
        .filter((usage) => usage.organizationId === organizationId)
        .map((usage) => [usage.grantId, usage.viewCount]),
    );
    return this.memory.grants
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          row.scopeType === "RESOURCE" &&
          row.revokedAt === null,
      )
      .map((row) => ({
        grantId: row.id,
        source: row.source,
        token: row.token,
        resourceKind: row.resourceKind,
        resourceId: row.scopeId,
        projectId: row.projectId,
        principalType: row.principalType,
        principalId: row.principalId,
        expiresAtMs: row.expiresAt?.epochMilliseconds ?? null,
        maxViews: row.maxViews,
        viewCount: viewCounts.get(row.id) ?? 0,
      }));
  }

  private membershipsOf(organizationId: string) {
    const prefix = `${organizationId}:`;
    return [...this.memory.memberships.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, row]) => ({ userId: key.slice(prefix.length), row }));
  }

  private projectsOf(organizationId: string) {
    return this.memory.projects.filter((project) =>
      this.memory.isTeamIn(project.teamId, organizationId),
    );
  }
}

/** A stored JSON column hands back a fresh value on every read. */
function copyPermissions(permissions: unknown): unknown {
  return Array.isArray(permissions) ? [...permissions] : permissions;
}
