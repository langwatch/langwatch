import type { GatewayVirtualKeyRecord, GatewayVirtualKeyScope } from "@langwatch/gateway-contract";
import { identityPatchData } from "@langwatch/gateway-contract";
/**
 * Data-access for VirtualKey. Post-collapse: organization-scoped + reachable
 * from N (scopeType, scopeId) VirtualKeyScope entries. dbMultiTenancyProtection
 * enforces every where-clause carries organizationId, an id, a secret, or scopes.
 */
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";
import { z } from "zod";

import type { GatewayPersistenceTransaction } from "../../app/gateway.members.ts";
import {
  gatewayRoutingPolicySelect,
  GatewayVirtualKeyRepository,
  type CreateGatewayVirtualKeyInput,
  type GatewayLicensedKey,
  type SetGatewayVirtualKeyDisabledInput,
  type UpdateGatewayVirtualKeyInput,
} from "../../repositories/gateway-virtual-key.repository.ts";
import { keysetAfter } from "../../rules/gateway-wire-pagination.rules.ts";

/**
 * Routing-policy columns the materialiser reads off a virtual key — one constant, not a copy
 * per query: a site missing a column doesn't fail, it silently materializes a bundle without
 * it (a policy's tier fallthrough stops reaching the gateway with nothing to notice).
 */
export type VirtualKeyWithScopes = GatewayVirtualKeyRecord;
export type ScopeInput = GatewayVirtualKeyScope;
export type CreateVirtualKeyData = CreateGatewayVirtualKeyInput;
export type SetVirtualKeyDisabledData = SetGatewayVirtualKeyDisabledInput;

export class PrismaGatewayVirtualKeyRepository extends GatewayVirtualKeyRepository {
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

  async findById(
    { id, organizationId }: { id: string; organizationId: string },
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = this.client(tx);
    return toVirtualKeyRecordFrom(
      client.virtualKey.findFirst({
        where: { id, organizationId },
        include: {
          scopes: true,
          principalUser: { select: { id: true, name: true, email: true } },
          routingPolicy: {
            select: gatewayRoutingPolicySelect,
          },
        },
      }),
    );
  }

  async findMetaByIds({
    organizationId,
    ids,
  }: {
    organizationId: string;
    ids: string[];
  }): Promise<{ id: string; name: string; displayPrefix: string }[]> {
    if (ids.length === 0) return [];

    return this.client().virtualKey.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, displayPrefix: true },
    });
  }

  async findByIdGlobal(
    id: string,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = this.client(tx);
    return toVirtualKeyRecordFrom(
      client.virtualKey.findUnique({
        where: { id },
        include: {
          scopes: true,
          principalUser: { select: { id: true, name: true, email: true } },
          routingPolicy: {
            select: gatewayRoutingPolicySelect,
          },
        },
      }),
    );
  }

  async findByHashedSecret(
    hashedSecret: string,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes | null> {
    const client = this.client(tx);
    return toVirtualKeyRecordFrom(
      client.virtualKey.findFirst({
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
      }),
    );
  }

  /**
   * Customer-facing org listing excludes product-managed keys (purpose != USER) — surfacing
   * them would invite a rotate that silently breaks the feature holding the secret. The ROUTE
   * still filters by caller visibility, so a page can come back shorter than limit.
   */
  async findPageInOrganization(args: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Instant; id: string } | null;
    /** Exact match, not a prefix: this is an id, not a search box. */
    externalId?: string;
  }): Promise<VirtualKeyWithScopes[]> {
    return toVirtualKeyRecordsFrom(
      this.prisma.virtualKey.findMany({
        where: {
          organizationId: args.organizationId,
          purpose: "USER",
          ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
          ...(args.cursor
            ? {
                OR: keysetAfter([
                  {
                    name: "createdAt",
                    value: toDate(args.cursor.createdAt),
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
      }),
    );
  }

  async findAllInOrganization(
    organizationId: string,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = this.client(tx);
    return toVirtualKeyRecordsFrom(
      client.virtualKey.findMany({
        where: { organizationId, purpose: "USER" },
        include: {
          scopes: true,
          principalUser: { select: { id: true, name: true, email: true } },
          routingPolicy: {
            select: gatewayRoutingPolicySelect,
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  /**
   * Live keys held by a person (any person when unnamed), newest first: main's
   * personal-key reads.
   */
  async findLiveWithPrincipal(input: {
    organizationId?: string;
    principalUserId?: string;
  }): Promise<VirtualKeyWithScopes[]> {
    return toVirtualKeyRecordsFrom(
      this.client().virtualKey.findMany({
        where: {
          ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
          principalUserId:
            input.principalUserId === undefined ? { not: null } : { equals: input.principalUserId },
          revokedAt: null,
        },
        include: {
          scopes: true,
          principalUser: { select: { id: true, name: true, email: true } },
          routingPolicy: { select: gatewayRoutingPolicySelect },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  /**
   * Every customer-owned VK reachable from a given scope entry, for project/team/org settings
   * pages listing keys with a matching scope row. Product-managed keys excluded, same reason
   * as findAllInOrganization.
   */
  async findAllForScope(
    scope: ScopeInput,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes[]> {
    const client = this.client(tx);
    return toVirtualKeyRecordsFrom(
      client.virtualKey.findMany({
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
      }),
    );
  }

  async create(
    data: CreateVirtualKeyData,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);
    return toVirtualKeyRecordOf(
      client.virtualKey.create({
        data: {
          id: data.id,
          organizationId: data.organizationId,
          name: data.name,
          description: data.description ?? null,
          hashedSecret: data.hashedSecret,
          displayPrefix: data.displayPrefix,
          principalUserId: data.principalUserId ?? null,
          traceProjectId: data.traceProjectId ?? null,
          expiresAt: data.expiresAt ? toDate(data.expiresAt) : null,
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
      }),
    );
  }

  async update(
    input: UpdateGatewayVirtualKeyInput,
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);

    return toVirtualKeyRecordOf(
      client.virtualKey.update({
        where: { id: input.id, organizationId: input.organizationId },
        data: {
          name: input.name,
          description: input.description,
          config: jsonInput(input.config),
          ...identityPatchData(input),
          ...(input.routingPolicyId !== undefined
            ? { routingPolicyId: input.routingPolicyId }
            : {}),
          ...(input.expiresAt !== undefined
            ? { expiresAt: input.expiresAt ? toDate(input.expiresAt) : null }
            : {}),
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
      }),
    );
  }

  async findRoutingPolicyOwner({
    routingPolicyId,
  }: {
    routingPolicyId: string;
  }): Promise<{ organizationId: string } | null> {
    return this.prisma.routingPolicy.findUnique({
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
      previousSecretValidUntil: Instant;
    },
    tx?: GatewayPersistenceTransaction,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);
    return toVirtualKeyRecordOf(
      client.virtualKey.update({
        where: { id, organizationId },
        data: {
          hashedSecret: newHashedSecret,
          displayPrefix: newDisplayPrefix,
          previousHashedSecret,
          previousSecretValidUntil: toDate(previousSecretValidUntil),
          revision: { increment: 1n },
        },
        include: {
          scopes: true,
          principalUser: { select: { id: true, name: true, email: true } },
          routingPolicy: {
            select: gatewayRoutingPolicySelect,
          },
        },
      }),
    );
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
    return toVirtualKeyRecordOf(
      client.virtualKey.update({
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
      }),
    );
  }

  async setDisabled(
    data: SetVirtualKeyDisabledData,
    tx?: Prisma.TransactionClient,
  ): Promise<VirtualKeyWithScopes> {
    const client = this.client(tx);
    return toVirtualKeyRecordOf(
      client.virtualKey.update({
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
      }),
    );
  }

  async setConnectServices(
    input: { id: string; organizationId: string; services: readonly string[] },
    tx?: GatewayPersistenceTransaction,
  ): Promise<boolean> {
    const { count } = await this.client(tx).virtualKey.updateMany({
      where: { id: input.id, organizationId: input.organizationId, purpose: "CONNECT" },
      data: { connectServices: [...input.services], revision: { increment: 1n } },
    });

    return count > 0;
  }

  async setLicenseFacts(
    input: {
      id: string;
      organizationId: string;
      tokenHash: string;
      instanceId: string | null;
      expiresAt: Instant | null;
    },
    tx?: GatewayPersistenceTransaction,
  ): Promise<boolean> {
    const { count } = await this.client(tx).virtualKey.updateMany({
      where: { id: input.id, organizationId: input.organizationId, purpose: "CONNECT" },
      data: {
        licenseTokenHash: input.tokenHash,
        licenseInstanceId: input.instanceId,
        licenseExpiresAt: input.expiresAt ? toDate(input.expiresAt) : null,
        revision: { increment: 1n },
      },
    });

    return count > 0;
  }

  async findByLicenseTokenHash(tokenHash: string): Promise<GatewayLicensedKey | null> {
    const row = await this.client().virtualKey.findUnique({
      where: { licenseTokenHash: tokenHash },
      include: {
        scopes: true,
        principalUser: { select: { id: true, name: true, email: true } },
        routingPolicy: { select: gatewayRoutingPolicySelect },
      },
    });
    if (!row || row.purpose !== "CONNECT") return null;

    return {
      key: toVirtualKeyRecord(row),
      instanceId: row.licenseInstanceId,
      expiresAt: row.licenseExpiresAt ? fromDate(row.licenseExpiresAt) : null,
      services: row.connectServices,
    };
  }

  async recordUsage(id: string, at: Instant, tx?: GatewayPersistenceTransaction): Promise<void> {
    const client = this.client(tx);
    await client.virtualKey.update({
      where: { id },
      data: { lastUsedAt: toDate(at) },
    });
  }
}

/** The moments a key carries, once read off the stored columns. */
type KeyMoments = {
  disabledAt: Instant | null;
  expiresAt: Instant | null;
  previousSecretValidUntil: Instant | null;
  revokedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  lastUsedAt: Instant | null;
};

/** The stored columns a key's instants are read off. */
type StoredKeyMoments = {
  disabledAt: Date | null;
  expiresAt: Date | null;
  previousSecretValidUntil: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
};

/** A read that hands back one key, or none, mapped onto instants. */
async function toVirtualKeyRecordFrom<Row extends StoredKeyMoments>(
  query: PromiseLike<Row | null>,
): Promise<(Omit<Row, keyof StoredKeyMoments> & KeyMoments) | null> {
  const row = await query;

  return row ? toVirtualKeyRecord(row) : null;
}

/** A write that hands back the one key it touched, mapped onto instants. */
async function toVirtualKeyRecordOf<Row extends StoredKeyMoments>(
  query: PromiseLike<Row>,
): Promise<Omit<Row, keyof StoredKeyMoments> & KeyMoments> {
  return toVirtualKeyRecord(await query);
}

/** A read that hands back many keys, mapped onto instants. */
async function toVirtualKeyRecordsFrom<Row extends StoredKeyMoments>(
  query: PromiseLike<Row[]>,
): Promise<(Omit<Row, keyof StoredKeyMoments> & KeyMoments)[]> {
  return (await query).map(toVirtualKeyRecord);
}

/** The one place a stored key's Dates become instants. */
function toVirtualKeyRecord<Row extends StoredKeyMoments>(
  row: Row,
): Omit<Row, keyof StoredKeyMoments> & KeyMoments {
  return {
    ...row,
    disabledAt: row.disabledAt ? fromDate(row.disabledAt) : null,
    expiresAt: row.expiresAt ? fromDate(row.expiresAt) : null,
    previousSecretValidUntil: row.previousSecretValidUntil
      ? fromDate(row.previousSecretValidUntil)
      : null,
    revokedAt: row.revokedAt ? fromDate(row.revokedAt) : null,
    createdAt: fromDate(row.createdAt),
    updatedAt: fromDate(row.updatedAt),
    lastUsedAt: row.lastUsedAt ? fromDate(row.lastUsedAt) : null,
  };
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return z.json().parse(value) as Prisma.InputJsonValue;
}
