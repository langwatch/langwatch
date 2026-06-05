import type {
  ApiKey,
  Prisma,
  PrismaClient,
  RoleBinding,
} from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";

export type ApiKeyWithBindings = ApiKey & {
  roleBindings: RoleBinding[];
};

/**
 * The subset of the Prisma surface we rely on here. Accepting both the root
 * `PrismaClient` and the transaction client lets callers share one repository
 * implementation between normal calls and `$transaction` blocks without
 * casting the transaction handle back up to `PrismaClient`.
 */
export type ApiKeyPrismaDelegate = PrismaClient | Prisma.TransactionClient;

export class ApiKeyRepository {
  constructor(private readonly prisma: ApiKeyPrismaDelegate) {}

  static create(prisma: ApiKeyPrismaDelegate): ApiKeyRepository {
    return new ApiKeyRepository(prisma);
  }

  async create({
    name,
    description,
    lookupId,
    hashedSecret,
    permissionMode,
    userId,
    createdByUserId,
    organizationId,
    expiresAt,
    ingestSourceType,
    ingestionTemplateId,
  }: {
    name: string;
    description?: string | null;
    lookupId: string;
    hashedSecret: string;
    permissionMode: string;
    userId?: string | null;
    createdByUserId?: string | null;
    organizationId: string;
    expiresAt?: Date | null;
    ingestSourceType?: string | null;
    ingestionTemplateId?: string | null;
  }): Promise<ApiKey> {
    return this.prisma.apiKey.create({
      data: {
        name,
        description: description ?? null,
        lookupId,
        hashedSecret,
        permissionMode,
        userId: userId ?? null,
        createdByUserId: createdByUserId ?? null,
        organizationId,
        expiresAt: expiresAt ?? null,
        ingestSourceType: ingestSourceType ?? null,
        ingestionTemplateId: ingestionTemplateId ?? null,
      },
    });
  }

  /**
   * Finds the live ingestion key for a (project, sourceType) pair: a non-revoked
   * ApiKey carrying that ingestSourceType whose role binding is project-scoped to
   * `projectId`. Used by the ingest-key service to rotate-in-place rather than
   * accumulate keys.
   */
  async findIngestKey({
    organizationId,
    projectId,
    sourceType,
  }: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<ApiKeyWithBindings | null> {
    return this.prisma.apiKey.findFirst({
      where: {
        organizationId,
        ingestSourceType: sourceType,
        revokedAt: null,
        roleBindings: {
          some: { scopeType: RoleBindingScopeType.PROJECT, scopeId: projectId },
        },
      },
      include: { roleBindings: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Lists every live ingestion key (`ingestSourceType IS NOT NULL`, not
   * revoked) whose role binding is project-scoped to `projectId`. Powers
   * the /me Trace Ingest installed-state lookup so a connected tile stays
   * green-checked across reloads.
   */
  async findIngestKeysForProject({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }): Promise<ApiKeyWithBindings[]> {
    return this.prisma.apiKey.findMany({
      where: {
        organizationId,
        ingestSourceType: { not: null },
        revokedAt: null,
        roleBindings: {
          some: { scopeType: RoleBindingScopeType.PROJECT, scopeId: projectId },
        },
      },
      include: { roleBindings: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findByLookupId({
    lookupId,
  }: {
    lookupId: string;
  }): Promise<ApiKeyWithBindings | null> {
    // Reject personal API keys whose owning user has been deactivated.
    // Service keys (userId = null) are always eligible.
    // We use findFirst rather than findUnique because Prisma's findUnique
    // does not accept related filters; lookupId is @unique so the result
    // is still unique.
    return this.prisma.apiKey.findFirst({
      where: {
        lookupId,
        OR: [
          { userId: null },
          { user: { deactivatedAt: null } },
        ],
      },
      include: { roleBindings: true },
    });
  }

  async findById({
    id,
  }: {
    id: string;
  }): Promise<ApiKeyWithBindings | null> {
    return this.prisma.apiKey.findUnique({
      where: { id },
      include: { roleBindings: true },
    });
  }

  async findAllByUser({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<ApiKeyWithBindings[]> {
    // Include both the user's own keys and service keys (userId = null)
    return this.prisma.apiKey.findMany({
      where: {
        organizationId,
        revokedAt: null,
        OR: [{ userId }, { userId: null }],
      },
      include: {
        roleBindings: {
          include: { customRole: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ApiKeyWithBindings[]> {
    return this.prisma.apiKey.findMany({
      where: { organizationId, revokedAt: null },
      include: {
        roleBindings: {
          include: { customRole: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update({
    id,
    name,
    description,
    permissionMode,
  }: {
    id: string;
    name?: string;
    description?: string | null;
    permissionMode?: string;
  }): Promise<ApiKey> {
    return this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(permissionMode !== undefined && { permissionMode }),
      },
    });
  }

  async upgradeHash({ id, hashedSecret }: { id: string; hashedSecret: string }): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { hashedSecret },
    });
  }

  async revoke({ id }: { id: string }): Promise<ApiKey> {
    return this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async updateLastUsedAt({ id }: { id: string }): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Replaces all role bindings for an API key. Deletes existing ones first,
   * then creates the new set — all within the caller's transaction.
   */
  async replaceRoleBindings({
    apiKeyId,
    organizationId,
    bindings,
  }: {
    apiKeyId: string;
    organizationId: string;
    bindings: Array<{
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId?: string | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  }): Promise<{ count: number }> {
    await this.prisma.roleBinding.deleteMany({
      where: { apiKeyId },
    });

    if (bindings.length === 0) return { count: 0 };

    return this.prisma.roleBinding.createMany({
      data: bindings.map((b) => ({
        organizationId,
        apiKeyId,
        role: b.role,
        customRoleId: b.role === "CUSTOM" ? (b.customRoleId ?? null) : null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      })),
    });
  }

  async findOrgMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ userId: string } | null> {
    return this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { userId: true },
    });
  }

  async findTeamInOrg({
    teamId,
    organizationId,
  }: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string } | null> {
    return this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
      select: { id: true },
    });
  }

  async findProjectWithTeam({
    projectId,
  }: {
    projectId: string;
  }): Promise<{
    id: string;
    team: { id: string; organizationId: string };
  } | null> {
    return this.prisma.project.findUnique({
      where: { id: projectId, archivedAt: null },
      include: { team: { select: { id: true, organizationId: true } } },
    });
  }

  async findOrgAdminBinding({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ userId: string | null } | null> {
    return this.prisma.roleBinding.findFirst({
      where: {
        userId,
        organizationId,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        role: TeamUserRole.ADMIN,
      },
      select: { userId: true },
    });
  }

  async findUserBindings({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }) {
    return this.prisma.roleBinding.findMany({
      where: { userId, organizationId },
      select: {
        id: true,
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });
  }

  async findOrgsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  async findTeamsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.team.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  async findProjectsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.project.findMany({
      where: { id: { in: ids }, archivedAt: null },
      select: { id: true, name: true },
    });
  }

  async findCustomRolesByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.customRole.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, permissions: true },
    });
  }

  async findUsersByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
  }

  async findProjectsInOrg({ organizationId }: { organizationId: string }) {
    return this.prisma.project.findMany({
      where: { team: { organizationId }, archivedAt: null },
      select: { id: true, name: true, teamId: true },
      orderBy: { name: "asc" },
    });
  }

  async findTeamsInOrg({ organizationId }: { organizationId: string }) {
    return this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async findOrgMembers({ organizationId }: { organizationId: string }) {
    const orgUsers = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return orgUsers.map((ou) => ({
      id: ou.user.id,
      name: ou.user.name,
      email: ou.user.email,
    }));
  }

  /**
   * Inserts all role bindings for an API key in a single query.
   */
  async createRoleBindings({
    apiKeyId,
    organizationId,
    bindings,
  }: {
    apiKeyId: string;
    organizationId: string;
    bindings: Array<{
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId?: string | null;
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  }): Promise<{ count: number }> {
    if (bindings.length === 0) return { count: 0 };

    return this.prisma.roleBinding.createMany({
      data: bindings.map((b) => ({
        organizationId,
        apiKeyId,
        role: b.role,
        customRoleId: b.role === "CUSTOM" ? (b.customRoleId ?? null) : null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      })),
    });
  }
}
