/**
 * Data-access for VirtualKey. Post-collapse model: organization-scoped + reachable from N (scopeType, scopeId) entries in VirtualKeyScope. dbMultiTenancyProtection enforces every where-clause carries organizationId, a row id, a hashedSecret, or a scopes:{some:{...}} predicate.
 */
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { identityPatchData } from "@langwatch/gateway-contract";
import { z } from "zod";
import { GatewayWirePaginationAdapter } from "../../adapters/gateway-wire-pagination.adapter";
import { gatewayRoutingPolicySelect } from "../../ports/gateway-virtual-key.port";
import {
  GatewayVirtualKeysPort,
  type CreateGatewayVirtualKeyInput,
  type GatewayVirtualKeyRecord,
  type GatewayVirtualKeyScope,
  type SetGatewayVirtualKeyDisabledInput,
  type UpdateGatewayVirtualKeyInput,
} from "../../ports/gateway-virtual-key.port";
import type { GatewayPersistenceTransaction } from "../../ports/gateway-change-events.port";

const wirePages = GatewayWirePaginationAdapter.create();
/**
 * Routing-policy columns the materialiser reads off a virtual key — one constant, not a copy per query: this select appears on every read path, and a site missing a column doesn't fail, it silently materializes a bundle without it (a policy's tier fallthrough stops reaching the gateway with nothing to notice).
 */
export type VirtualKeyWithScopes = GatewayVirtualKeyRecord;
export type ScopeInput = GatewayVirtualKeyScope;
export type CreateVirtualKeyData = CreateGatewayVirtualKeyInput;
export type SetVirtualKeyDisabledData = SetGatewayVirtualKeyDisabledInput;

export class PrismaGatewayVirtualKeyRepository extends GatewayVirtualKeysPort {
  static create(database: PrismaClient): PrismaGatewayVirtualKeyRepository {
    return new PrismaGatewayVirtualKeyRepository(database);
  }

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  private client(
    transaction?: GatewayPersistenceTransaction,
  ): PrismaClient | Prisma.TransactionClient {
    return transaction ? (transaction as Prisma.TransactionClient) : this.prisma;
  }

  async tryFindById(
    { id, organizationId }: { id: string; organizationId: string },
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = this.client(tx);
    return client.virtualKey.findFirst({
      where: { id, organizationId },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: gatewayRoutingPolicySelect,
        },
      },
    });
  }

  async findMetaByIds({
    organizationId,
    ids,
  }: {
    organizationId: string;
    ids: string[];
  }): Promise<Array<{ id: string; name: string; displayPrefix: string }>> {
    if (ids.length === 0) return [];

    return this.client().virtualKey.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, displayPrefix: true },
    });
  }

  async tryFindByIdGlobal(
    id: string,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = this.client(tx);
    return client.virtualKey.findUnique({
      where: { id },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: gatewayRoutingPolicySelect,
        },
      },
    });
  }

  async tryFindByHashedSecret(
    hashedSecret: string,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = this.client(tx);
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
          select: gatewayRoutingPolicySelect,
        },
      },
    });
  }

  /**
   * Customer-facing org listing excludes product-managed keys (purpose != USER, e.g. the Langy VK) — the customer neither created nor may mutate them, so surfacing them only invites a rotate that silently breaks the feature holding the secret (internal lookups needing them use tryFindById/tryFindByHashedSecret, unfiltered; same posture as HIDDEN_SYSTEM_KEY_NAMES). One page, newest first, keyed (createdAt, id); the ROUTE still filters by caller visibility, so a page can come back shorter than limit with nothing skipped, just unevenly distributed.
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
              OR: wirePages.keysetAfter([
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
          select: gatewayRoutingPolicySelect,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: args.limit,
    });
  }

  async findAllInOrganization(
    organizationId: string,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = this.client(tx);
    return client.virtualKey.findMany({
      where: { organizationId, purpose: "USER" },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: {
          select: gatewayRoutingPolicySelect,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Every customer-owned VK reachable from a given scope entry, for project/team/org settings pages listing keys with a matching scope row. Product-managed keys excluded, same reason as findAllInOrganization.
   */
  async findAllForScope(
    scope: ScopeInput,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = this.client(tx);
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
          select: gatewayRoutingPolicySelect,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(
    data: CreateVirtualKeyData,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);
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
        config: jsonInput(data.config),
        externalId: data.externalId ?? null,
        ...(data.metadata !== undefined ? { metadata: jsonInput(data.metadata) } : {}),
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
          select: gatewayRoutingPolicySelect,
        },
      },
    });
  }

  async update(
    input: UpdateGatewayVirtualKeyInput,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);

    return client.virtualKey.update({
      where: { id: input.id, organizationId: input.organizationId },
      data: {
        name: input.name,
        description: input.description,
        config: jsonInput(input.config),
        ...identityPatchData(input),
        ...(input.routingPolicyId !== undefined ? { routingPolicyId: input.routingPolicyId } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        traceProjectId: input.traceProjectId,
        routingMode: input.routingMode,
        revision: { increment: 1n },
      },
      // The same projection every other read materialises. Without the two
      // relations the row is not a `VirtualKeyWithScopes`: the update would
      // answer a key whose principal and routing policy read as absent to
      // everything downstream of it.
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: { select: gatewayRoutingPolicySelect },
      },
    });
  }

  async tryFindRoutingPolicyOwner({
    routingPolicyId,
  }: {
    routingPolicyId: string;
  }): Promise<{ organizationId: string } | null> {
    return await this.prisma.routingPolicy.findUnique({
      where: { id: routingPolicyId },
      select: { organizationId: true },
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
    tx?: GatewayPersistenceTransaction,
  ): Promise<void> {
    const client = this.client(tx);
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

  async rotateSecret(
    {
      id,
      organizationId,
      newHashedSecret,
      newDisplayPrefix,
      previousHashedSecret,
      previousSecretValidUntil,
    }: {
      id: string;
      organizationId: string;
      newHashedSecret: string;
      newDisplayPrefix: string;
      previousHashedSecret: string;
      previousSecretValidUntil: Date;
    },
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);
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
          select: gatewayRoutingPolicySelect,
        },
      },
    });
  }

  async revoke(
    {
      id,
      organizationId,
      revokedById,
    }: { id: string; organizationId: string; revokedById: string },
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);
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
          select: gatewayRoutingPolicySelect,
        },
      },
    });
  }

  async setDisabled(
    data: SetVirtualKeyDisabledData,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);
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
          select: gatewayRoutingPolicySelect,
        },
      },
    });
  }

  async recordUsage(id: string, at: Date, tx?: GatewayPersistenceTransaction): Promise<void> {
    const client = this.client(tx);
    await client.virtualKey.update({
      where: { id },
      data: { lastUsedAt: at },
    });
  }
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return z.json().parse(value) as Prisma.InputJsonValue;
}
