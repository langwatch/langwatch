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
  VirtualKeyRoutingMode,
  VirtualKeyScope,
  VirtualKeyScopeType,
} from "~/generated/prisma/client";
import { keysetAfter } from "./wirePagination";

/**
 * The routing-policy columns the materialiser reads off a virtual key.
 *
 * One constant rather than a copy per query: this select appears on every
 * read path, and a site that misses a column does not fail, it silently
 * materializes a bundle without it. That is how a policy's tier fallthrough
 * would stop reaching the gateway with nothing to notice it.
 */
export const ROUTING_POLICY_SELECT = {
  id: true,
  name: true,
  modelAliases: true,
  defaultModel: true,
  policyRules: true,
} as const;

export type VirtualKeyWithScopes = VirtualKey & {
  scopes: VirtualKeyScope[];
  principalUser?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  routingPolicy?: {
    id: string;
    name: string;
    modelAliases: Prisma.JsonValue;
    defaultModel: string | null;
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
  /** The caller's own id for the key. Null when it named none. */
  externalId?: string | null;
  /** Customer-owned bookkeeping, stored verbatim. */
  metadata?: Prisma.InputJsonValue;
  createdById: string;
  /**
   * Scope set the VK is reachable from. Empty array is rejected by the
   * caller (a VK with no scopes is unreachable in any UI surface). At
   * least one entry is required.
   */
  scopes: ScopeInput[];
  /** Explicit trace destination; grants no access (not a scope row). */
  traceProjectId?: string | null;
  /** When the key stops serving. Absent or null means it never expires. */
  expiresAt?: Date | null;
  routingPolicyId?: string | null;
  /**
   * Routing behaviour. Defaults to the column default (NONE: no
   * failover) when the caller does not state one.
   */
  routingMode?: VirtualKeyRoutingMode;
  /**
   * USER (default) for keys created via the gateway UI / API; LANGY when
   * auto-provisioned by `langyVirtualKey.provisionLangyVirtualKey` for the
   * Langy in-product assistant. Drives the managed-row badge + lock-down on
   * the gateway/virtual-keys page.
   */
  purpose?: "USER" | "LANGY";
};

export type SetVirtualKeyDisabledData = {
  id: string;
  organizationId: string;
  /** True parks the key as DISABLED; false returns it to ACTIVE. */
  disabled: boolean;
  /** Operator note kept on the row while disabled; cleared on re-enable. */
  reason: string | null;
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
          select: ROUTING_POLICY_SELECT,
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
          select: ROUTING_POLICY_SELECT,
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
          select: ROUTING_POLICY_SELECT,
        },
      },
    });
  }

  /**
   * The customer-facing organization listing. Product-managed keys
   * (`purpose != USER` — today the Langy VK) are excluded: the customer
   * neither created them nor may mutate them, so surfacing them only invites
   * a rotate that silently breaks the feature holding the secret. Internal
   * lookups that legitimately need them go through `findById` /
   * `findByHashedSecret`, which stay unfiltered. Same posture as
   * HIDDEN_SYSTEM_KEY_NAMES on the API-key listings.
   */
  /**
   * One page of an organization's keys, newest first, keyed on (createdAt, id).
   *
   * The ROUTE still filters the page by the caller's visibility, so a page can
   * come back shorter than `limit`; `next_cursor` is computed from the rows
   * this query returned, so nothing is skipped, only unevenly distributed.
   */
  async findPageInOrganization(args: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
    /** Exact match, not a prefix: this is an id, not a search box. */
    externalId?: string;
  }): Promise<VirtualKeyWithScopes[]> {
    return this.prisma.virtualKey.findMany({
      where: {
        organizationId: args.organizationId,
        purpose: "USER",
        ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
        ...(args.cursor
          ? {
              OR: keysetAfter([
                {
                  name: "createdAt",
                  value: args.cursor.createdAt,
                  direction: "desc",
                },
                { name: "id", value: args.cursor.id, direction: "desc" },
              ]),
            }
          : {}),
      },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: ROUTING_POLICY_SELECT,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: args.limit,
    });
  }

  async findAllInOrganization(
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findMany({
      where: { organizationId, purpose: "USER" },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: ROUTING_POLICY_SELECT,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Every customer-owned VK reachable from a given scope entry. Used for the
   * project / team / org settings pages — each page lists VKs that
   * declare at least one matching scope row. Product-managed keys are
   * excluded for the same reason as `findAllInOrganization`.
   */
  async findAllForScope(
    scope: ScopeInput,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = tx ?? this.prisma;
    return client.virtualKey.findMany({
      where: {
        purpose: "USER",
        scopes: {
          some: { scopeType: scope.scopeType, scopeId: scope.scopeId },
        },
      },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: ROUTING_POLICY_SELECT,
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
        traceProjectId: data.traceProjectId ?? null,
        expiresAt: data.expiresAt ?? null,
        config: data.config,
        externalId: data.externalId ?? null,
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        createdById: data.createdById,
        routingPolicyId: data.routingPolicyId ?? null,
        ...(data.routingMode ? { routingMode: data.routingMode } : {}),
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
          select: ROUTING_POLICY_SELECT,
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
          select: ROUTING_POLICY_SELECT,
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
          select: ROUTING_POLICY_SELECT,
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
          select: ROUTING_POLICY_SELECT,
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
          select: ROUTING_POLICY_SELECT,
        },
      },
    });
  }

  async setDisabled(
    data: SetVirtualKeyDisabledData,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = tx ?? this.prisma;
    return client.virtualKey.update({
      where: { id: data.id, organizationId: data.organizationId },
      data: data.disabled
        ? {
            status: "DISABLED",
            disabledAt: new Date(),
            disabledReason: data.reason,
            revision: { increment: 1n },
          }
        : {
            // Rotation-grace fields are deliberately untouched in BOTH
            // directions: disable is reversible, and a key re-enabled
            // mid-grace must keep honoring its previous secret.
            status: "ACTIVE",
            disabledAt: null,
            disabledReason: null,
            revision: { increment: 1n },
          },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: ROUTING_POLICY_SELECT,
        },
      },
    });
  }

  async recordUsage(id: string, at: Date, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.virtualKey.update({
      where: { id },
      data: { lastUsedAt: at },
    });
  }
}
