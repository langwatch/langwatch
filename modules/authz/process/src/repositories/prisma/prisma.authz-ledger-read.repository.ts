import { OffboardIncompleteError } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { type Instant, fromDate, toDate } from "@langwatch/time";

import {
  AuthzLedgerReadRepository,
  type LedgerDirectoryGrantRow,
  type LedgerGrantIdentity,
  type LedgerRoleDefinition,
} from "../authz-ledger-read.repository.ts";
import type { AuthzReadRepository } from "../authz-read.repository.ts";
import { liveGrants, liveRoles } from "../eventing/eventing.authz-live-rows.mapper.ts";
import { EventingAuthzReadRepository } from "../eventing/eventing.authz-read.repository.ts";
import {
  GRANT_ROW_COLUMNS,
  type GrantRowShape,
  grantRowFromStored,
} from "./prisma.authz-grant.mapper.ts";
import type { AuthzGrantFilter } from "./prisma.authz-ledger.mapper.ts";

/**
 * Membership deletion needs an explicit budget (timeout + maxWait) because
 * prove holds row locks while reading.
 */
const OFFBOARD_MEMBERSHIP_TXN_OPTIONS = {
  timeout: 15_000,
  maxWait: 10_000,
} as const;

const DIRECTORY_GRANT_COLUMNS = {
  id: true,
  principalId: true,
  createdAt: true,
  revokedAt: true,
} as const;

function directoryRow(row: {
  id: string;
  principalId: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}): LedgerDirectoryGrantRow {
  return {
    id: row.id,
    principalId: row.principalId,
    createdAt: fromDate(row.createdAt),
    revokedAt: row.revokedAt ? fromDate(row.revokedAt) : null,
  };
}

/** The ledger's and the grant writer's reads over the live Grant and Role heads. */
export class PrismaAuthzLedgerReadRepository extends AuthzLedgerReadRepository {
  static create({ prisma }: Readonly<{ prisma: PrismaClient }>): PrismaAuthzLedgerReadRepository {
    return new PrismaAuthzLedgerReadRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async countLandedGrants({
    organizationId,
    grants,
    occurredSince,
  }: {
    organizationId: string;
    grants: readonly (LedgerGrantIdentity & { id: string })[];
    occurredSince: Instant;
  }): Promise<number> {
    const occurredAt = { gte: toDate(occurredSince) };
    return this.prisma.grant.count({
      where: {
        organizationId,
        revokedAt: null,
        OR: grants.map((grant) => ({ ...grant, occurredAt })),
      },
    } as never);
  }

  async findLiveGrantsByIdentity({
    organizationId,
    identities,
  }: {
    organizationId: string;
    identities: readonly LedgerGrantIdentity[];
  }): Promise<GrantRowShape[]> {
    if (identities.length === 0) return [];
    const rows = await liveGrants(this.prisma).findMany({
      where: { organizationId, OR: [...identities] },
      select: GRANT_ROW_COLUMNS,
    });
    return rows.map((row) => grantRowFromStored(row));
  }

  async findLiveGrant({
    grantId,
    organizationId,
  }: {
    grantId: string;
    organizationId?: string;
  }): Promise<GrantRowShape | null> {
    const stored = await liveGrants(this.prisma).findFirst({
      where: organizationId === undefined ? { id: grantId } : { id: grantId, organizationId },
      select: GRANT_ROW_COLUMNS,
    });
    return stored === null || stored === undefined ? null : grantRowFromStored(stored);
  }

  async findLiveGrantRoleKey({
    grantId,
    organizationId,
  }: {
    grantId: string;
    organizationId: string;
  }): Promise<{ roleKey: string | null } | null> {
    const row = (await liveGrants(this.prisma).findFirst({
      where: { id: grantId, organizationId },
      select: { roleKey: true },
    })) as { roleKey: string | null } | null | undefined;
    return row ?? null;
  }

  async hasLiveGrant({
    grantId,
    organizationId,
    scopeType,
    projectId,
  }: {
    grantId: string;
    organizationId: string;
    scopeType: "RESOURCE" | "PLATFORM";
    projectId?: string;
  }): Promise<boolean> {
    const row = await liveGrants(this.prisma).findFirst({
      where:
        projectId === undefined
          ? { id: grantId, organizationId, scopeType }
          : { id: grantId, organizationId, projectId, scopeType },
      select: { id: true },
    });
    return row !== null && row !== undefined;
  }

  async findLiveGrantIds({ where }: { where: AuthzGrantFilter }): Promise<string[]> {
    const rows = (await liveGrants(this.prisma).findMany({
      where,
      select: { id: true },
    })) as { id: string }[];
    return [...new Set(rows.map((row) => row.id))];
  }

  async findLiveRole({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }): Promise<LedgerRoleDefinition | null> {
    const row = (await liveRoles(this.prisma).findFirst({
      where: { id: roleId, organizationId },
      select: { name: true, description: true, permissions: true },
    })) as LedgerRoleDefinition | null | undefined;
    return row ?? null;
  }

  async hasLiveRole({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }): Promise<boolean> {
    const row = await liveRoles(this.prisma).findFirst({
      where: { id: roleId, organizationId },
      select: { id: true },
    });
    return row !== null && row !== undefined;
  }

  async findLiveCustomRole({
    roleId,
  }: {
    roleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null> {
    const row = (await liveRoles(this.prisma).findFirst({
      where: { id: roleId },
      select: { organizationId: true, permissions: true },
    })) as { organizationId: string; permissions: unknown } | null | undefined;
    return row ?? null;
  }

  async findDirectoryGrantIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.grant.findMany({
      where: {
        organizationId,
        principalType: "USER",
        principalId: { in: [...userIds] },
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        source: "scim",
        revokedAt: null,
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findDirectoryGrantHistory({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<{ attached: LedgerDirectoryGrantRow[]; removed: LedgerDirectoryGrantRow[] }> {
    const directory = {
      organizationId,
      principalType: "USER",
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      source: "scim",
    } as const;
    const [attached, removed] = await Promise.all([
      this.prisma.grant.findMany({
        where: directory,
        select: DIRECTORY_GRANT_COLUMNS,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      this.prisma.grant.findMany({
        where: { ...directory, revokedAt: { not: null } },
        select: DIRECTORY_GRANT_COLUMNS,
        orderBy: { revokedAt: "desc" },
        take: limit,
      }),
    ]);
    return { attached: attached.map(directoryRow), removed: removed.map(directoryRow) };
  }

  async findOwnedApiKeys({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.apiKey.findMany({
      where: { userId, organizationId, revokedAt: null },
      select: { id: true, name: true },
    });
  }

  async findPersonalTeams({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.team.findMany({
      where: { organizationId, isPersonal: true, ownerUserId: userId },
      select: { id: true, name: true },
    });
  }

  async offboardUser({
    userId,
    organizationId,
    revoke,
    prove,
  }: {
    userId: string;
    organizationId: string;
    revoke: (grantIds: string[]) => Promise<void>;
    prove: (reader: AuthzReadRepository) => Promise<void>;
  }): Promise<{
    groupMemberships: number;
    legacyTeamMemberships: number;
    pendingInvites: number;
    organizationMembership: boolean;
  }> {
    return this.prisma.$transaction(async (tx) => {
      // The membership row goes first: its lock serializes the grant snapshot
      // below with a stamped attach, whose projection now fails its stamp check.
      const organizationMembership = await tx.organizationUser.deleteMany({
        where: { userId, organizationId },
      });
      const liveUserGrants = {
        organizationId,
        principalType: "USER",
        principalId: userId,
        revokedAt: null,
      } as const;
      const grantRows = await tx.grant.findMany({ where: liveUserGrants, select: { id: true } });
      await revoke(grantRows.map((row) => row.id));

      // Legacy USER bindings stay only for migration; a departing user's rows
      // would let a later rejoin revive pre-offboard access.
      await tx.roleBinding.deleteMany({ where: { organizationId, userId } });
      const groupMemberships = await tx.groupMembership.deleteMany({
        where: { userId, group: { organizationId } },
      });
      const legacyTeamMemberships = await tx.teamUser.deleteMany({
        where: { userId, team: { organizationId } },
      });
      // Pending invites are keyed by email: read it inside the transaction so
      // the lookup and the delete commit or roll back together.
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      const email = user?.email ?? null;
      const pendingInvites = email
        ? await tx.organizationInvite.deleteMany({
            where: { organizationId, email, status: "PENDING" },
          })
        : { count: 0 };

      // Direct postcondition: the proof below gates on the membership this
      // transaction just deleted, so on its own it would pass vacuously.
      const remainingGrantHeads = await tx.grant.count({ where: liveUserGrants });
      if (remainingGrantHeads > 0) {
        throw new OffboardIncompleteError({ userId, organizationId, remainingGrantHeads });
      }
      await prove(EventingAuthzReadRepository.create(tx));

      return {
        groupMemberships: groupMemberships.count,
        legacyTeamMemberships: legacyTeamMemberships.count,
        pendingInvites: pendingInvites.count,
        organizationMembership: organizationMembership.count > 0,
      };
    }, OFFBOARD_MEMBERSHIP_TXN_OPTIONS);
  }
}
