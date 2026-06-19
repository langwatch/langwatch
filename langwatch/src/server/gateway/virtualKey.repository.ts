/**
 * Data-access for VirtualKey.
 *
 * Post-collapse model: VirtualKey is organization-scoped + reachable
 * from N (scopeType, scopeId) entries in `VirtualKeyScope`. The
 * dbMultiTenancyProtection middleware enforces that every where-clause
 * carries one of `organizationId`, a row id, a `hashedSecret`, or a
 * `scopes: { some: {...} }` predicate.
 */
import type {
  Prisma,
  PrismaClient,
  VirtualKey,
  VirtualKeyScope,
  VirtualKeyScopeType,
} from "@prisma/client";

export type VirtualKeyWithScopes = VirtualKey & {
  scopes: VirtualKeyScope[];
  principalUser?: { id: string; name: string | null; email: string | null } | null;
  routingPolicy?: {
    id: string;
    modelAliases: Prisma.JsonValue;
    policyRules: Prisma.JsonValue;
  } | null;
};

export type ScopeInput = {
  scopeType: VirtualKeyScopeType;
  scopeId: string;
};

export type CreateVirtualKeyData = {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  hashedSecret: string;
  displayPrefix: string;
  principalUserId?: string | null;
  config: Prisma.InputJsonValue;
  createdById: string;
  /**
   * Scope set the VK is reachable from. Empty array is rejected by the
   * caller (a VK with no scopes is unreachable in any UI surface). At
   * least one entry is required.
   */
  scopes: ScopeInput[];
  routingPolicyId?: string | null;
  /**
   * USER (default) for keys created via the gateway UI / API; LANGY when
   * auto-provisioned by `langyVirtualKey.provisionLangyVirtualKey` for the
   * Langy in-product assistant. Drives the managed-row badge + lock-down on
   * the gateway/virtual-keys page.
   */
  purpose?: "USER" | "LANGY";
};

export class VirtualKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findFirst({
      where: { id, organizationId },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  async findByIdGlobal(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findUnique({
      where: { id },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  async findByHashedSecret(
    hashedSecret: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findFirst({
      where: {
        OR: [
          { hashedSecret },
          {
            previousHashedSecret: hashedSecret,
            previousSecretValidUntil: { gt: new Date() },
          },
        ],
      },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  async findAllInOrganization(
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findMany({
      where: { organizationId },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Every VK reachable from a given scope entry. Used for the
   * project / team / org settings pages — each page lists VKs that
   * declare at least one matching scope row.
   */
  async findAllForScope(
    scope: ScopeInput,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findMany({
      where: {
        scopes: {
          some: { scopeType: scope.scopeType, scopeId: scope.scopeId },
        },
      },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(
    data: CreateVirtualKeyData,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = tx ?? this.prisma;
    return client.virtualKey.create({
      data: {
        id: data.id,
        organizationId: data.organizationId,
        name: data.name,
        description: data.description ?? null,
        hashedSecret: data.hashedSecret,
        displayPrefix: data.displayPrefix,
        principalUserId: data.principalUserId ?? null,
        config: data.config,
        createdById: data.createdById,
        routingPolicyId: data.routingPolicyId ?? null,
        purpose: data.purpose ?? "USER",
        revision: 1n,
        scopes: {
          create: data.scopes.map((s) => ({
            scopeType: s.scopeType,
            scopeId: s.scopeId,
          })),
        },
      },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  async updateConfig(
    id: string,
    organizationId: string,
    config: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id, organizationId },
      data: { config, revision: { increment: 1n } },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  /**
   * Replace the VK's scope set in-place. Used by the edit drawer when
   * an admin moves a VK between scopes. Two-step delete+createMany
   * matches the pattern used by ModelProviderRepository.replaceScopes.
   */
  async replaceScopes(
    id: string,
    scopes: ScopeInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.virtualKeyScope.deleteMany({ where: { virtualKeyId: id } });
    if (scopes.length === 0) return;
    await client.virtualKeyScope.createMany({
      data: scopes.map((s) => ({
        virtualKeyId: id,
        scopeType: s.scopeType,
        scopeId: s.scopeId,
      })),
    });
  }

  async setRoutingPolicy(
    id: string,
    organizationId: string,
    routingPolicyId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id, organizationId },
      data: { routingPolicyId, revision: { increment: 1n } },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  async rotateSecret(
    id: string,
    organizationId: string,
    newHashedSecret: string,
    newDisplayPrefix: string,
    previousHashedSecret: string,
    previousSecretValidUntil: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id, organizationId },
      data: {
        hashedSecret: newHashedSecret,
        displayPrefix: newDisplayPrefix,
        previousHashedSecret,
        previousSecretValidUntil,
        revision: { increment: 1n },
      },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  async revoke(
    id: string,
    organizationId: string,
    revokedById: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id, organizationId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedById,
        previousHashedSecret: null,
        previousSecretValidUntil: null,
        revision: { increment: 1n },
      },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: { id: true, modelAliases: true, policyRules: true },
        },
      },
    });
  }

  async recordUsage(
    id: string,
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.virtualKey.update({
      where: { id },
      data: { lastUsedAt: at },
    });
  }
}
