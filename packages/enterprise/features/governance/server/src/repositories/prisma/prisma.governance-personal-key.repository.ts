import {
  Prisma,
  type PrismaClient,
  type VirtualKey,
  type VirtualKeyScope,
} from "@langwatch/prisma-client/generated";
import type { PersonalVirtualKey } from "@langwatch/enterprise-governance-contract";
import { PersonalVirtualKeyRepository } from "../../ports/personal-virtual-key.port";

type KeyRow = VirtualKey & { scopes: VirtualKeyScope[] };

const includeScopes = { scopes: true } as const;

export class PrismaPersonalVirtualKeyRepository extends PersonalVirtualKeyRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaPersonalVirtualKeyRepository {
    return new PrismaPersonalVirtualKeyRepository(database as PrismaClient);
  }

  async tryFindDefault(input: {
    userId: string;
    organizationId: string;
    personalProjectId: string;
  }): Promise<PersonalVirtualKey | null> {
    const row = await this.database.virtualKey.findFirst({
      where: {
        organizationId: input.organizationId,
        principalUserId: input.userId,
        name: "default",
        revokedAt: null,
        scopes: {
          some: { scopeType: "PROJECT", scopeId: input.personalProjectId },
        },
      },
      include: includeScopes,
    });
    return row ? mapKey(row) : null;
  }

  async list(input: { organizationId: string; userId?: string }): Promise<PersonalVirtualKey[]> {
    const principalUserId: Prisma.StringNullableFilter<"VirtualKey"> =
      input.userId === undefined ? { not: null } : { equals: input.userId };
    const rows = await this.database.virtualKey.findMany({
      where: {
        organizationId: input.organizationId,
        principalUserId,
        revokedAt: null,
      },
      include: includeScopes,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapKey);
  }

  async tryFindOwned(input: {
    id: string;
    organizationId: string;
    userId: string;
  }): Promise<PersonalVirtualKey | null> {
    const row = await this.database.virtualKey.findFirst({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        principalUserId: input.userId,
      },
      include: includeScopes,
    });
    return row ? mapKey(row) : null;
  }

  async listActiveForUser(userId: string): Promise<PersonalVirtualKey[]> {
    const rows = await this.database.virtualKey.findMany({
      where: { principalUserId: userId, revokedAt: null },
      include: includeScopes,
    });
    return rows.map(mapKey);
  }

  async countEligibleProviders(input: {
    organizationId: string;
    personalTeamId?: string;
    personalProjectId: string;
  }): Promise<number> {
    const scopes: Prisma.ModelProviderScopeWhereInput[] = [
      { scopeType: "ORGANIZATION", scopeId: input.organizationId },
    ];
    if (input.personalTeamId) {
      scopes.push({ scopeType: "TEAM", scopeId: input.personalTeamId });
    }
    scopes.push({ scopeType: "PROJECT", scopeId: input.personalProjectId });
    return this.database.modelProvider.count({
      where: {
        enabled: true,
        disabledAt: null,
        scopes: { some: { OR: scopes } },
      },
    });
  }
}

function mapKey(row: KeyRow): PersonalVirtualKey {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    displayPrefix: row.displayPrefix,
    status: row.status,
    principalUserId: row.principalUserId,
    routingPolicyId: row.routingPolicyId,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
    lastUsedAtMs: row.lastUsedAt?.getTime() ?? null,
    scopes: row.scopes.map((scope) => ({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    })),
  };
}
