// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  LIVE_IDENTIFIER_STATES,
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  type SsoMigrationPhase,
} from "@langwatch/identity";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import type { SsoBreakGlassBindingRepository } from "./sso-connection.repository";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";
import {
  connectionRefOf,
  finalizationBlockers,
  identifierBelongsToMigrationConnection,
  inheritedDomainsOf,
  type LegacyAccountEvidence,
  MIGRATION_QUIET_PERIOD_MS,
  membersViewOf,
  migrationBlockers,
  routeOf,
  scimStatusOf,
} from "./sso-migration.rules";
import type {
  SsoMigrationFinalizationEvidence,
  SsoMigrationFinalizationReadPort,
} from "./sso-migration-finalization.service";
import { findOtherOrganizationIds } from "./sso-other-organization-memberships.prisma";
import type { SsoMigrationProgressReadPort } from "./sso-self-serve.service";
import type { SelfServeMigrationView } from "./sso-self-serve.types";

interface MigrationPair {
  organizationId: string;
  replacement: SsoConnectionState;
  legacy: SsoConnectionState;
  phase: SsoMigrationPhase;
}

interface MigrationEvidenceDependencies {
  prisma: PrismaClient;
  recovery: SsoBreakGlassBindingRepository;
  holdsPassword: (args: { userId: string }) => Promise<boolean>;
  now?: () => number;
}

const providerMetadata = z.object({ providerId: z.string() });

/** Each public read reloads evidence; finalization never trusts an earlier UI snapshot. */
export class PrismaSsoMigrationEvidenceRepository
  implements SsoMigrationProgressReadPort, SsoMigrationFinalizationReadPort
{
  readonly #prisma: PrismaClient;
  readonly #recovery: SsoBreakGlassBindingRepository;
  readonly #holdsPassword: (args: { userId: string }) => Promise<boolean>;
  readonly #now: () => number;

  private constructor({
    prisma,
    recovery,
    holdsPassword,
    now = Date.now,
  }: MigrationEvidenceDependencies) {
    this.#prisma = prisma;
    this.#recovery = recovery;
    this.#holdsPassword = holdsPassword;
    this.#now = now;
  }

  static create(
    deps: MigrationEvidenceDependencies,
  ): PrismaSsoMigrationEvidenceRepository {
    return new PrismaSsoMigrationEvidenceRepository(deps);
  }

  async getProgress({
    organizationId,
    connectionId,
    cursor,
    limit,
  }: {
    organizationId: string;
    connectionId?: string;
    cursor: string | null;
    limit: number;
  }): Promise<SelfServeMigrationView | null> {
    const pair = await this.#loadPair({ organizationId, connectionId });
    if (!pair) return null;

    const summary = await this.#loadSummary(pair);
    const stragglerRows = await this.#prisma.organizationUser.findMany({
      where: {
        organizationId,
        disabledAt: null,
        userId: {
          notIn: summary.linkedUserIds,
          ...(cursor ? { gt: cursor } : {}),
        },
      },
      orderBy: { userId: "asc" },
      take: limit + 1,
      select: { userId: true },
    });
    const pageRows = stragglerRows.slice(0, limit);
    const userIds = pageRows.map(({ userId }) => userId);
    const [users, activity] = await Promise.all([
      this.#prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.#prisma.ssoAuthenticationActivity.findMany({
        where: {
          organizationId,
          connectionId: pair.legacy.connectionId,
          userId: { in: userIds },
        },
        orderBy: { authenticatedAt: "desc" },
        select: { userId: true, authenticatedAt: true },
      }),
    ]);
    const people = new Map(users.map((user) => [user.id, user]));
    const legacyActivityByUser = new Map<string, Date>();
    for (const row of activity) {
      if (!legacyActivityByUser.has(row.userId))
        legacyActivityByUser.set(row.userId, row.authenticatedAt);
    }

    return {
      legacy: connectionRefOf(pair.legacy),
      replacement: connectionRefOf(pair.replacement),
      phase: pair.phase,
      selectedRoute: summary.selectedRoute,
      inheritedDomains: inheritedDomainsOf(pair),
      testSignIn: summary.testSignIn,
      members: membersViewOf({
        evidence: {
          activeCount: summary.activeCount,
          linkedCount: summary.linkedCount,
          stragglerRows,
          pageRows: pageRows.map(({ userId }) => ({
            userId,
            name: people.get(userId)?.name ?? null,
            email: people.get(userId)?.email ?? null,
          })),
          legacyActivityByUser,
        },
        limit,
      }),
      quietPeriod: summary.quietPeriod,
      scim: { status: summary.scimStatus },
      blockers: summary.blockers,
      canFinalize:
        summary.blockers.length === 0 &&
        (pair.phase === "GRACE_DIRECT" || pair.phase === "FINALIZING"),
    };
  }

  async inspect({
    organizationId,
    replacementConnectionId,
  }: {
    organizationId: string;
    replacementConnectionId: string;
  }): Promise<SsoMigrationFinalizationEvidence | null> {
    const pair = await this.#loadPair({
      organizationId,
      connectionId: replacementConnectionId,
    });
    if (!pair) return null;

    const summary = await this.#loadSummary(pair);
    const [qualifiedProofs, legacyAccounts, legacyDirectoryTokens, recovery] =
      await Promise.all([
        this.#qualifiedProofCount(pair),
        this.#legacyAccounts(
          pair,
          summary.verifiedUserIds,
          summary.activeCount,
        ),
        this.#prisma.scimToken.count({
          where: { organizationId, connectionId: pair.legacy.connectionId },
        }),
        this.#recovery.hasLiveBinding({ organizationId }),
      ]);
    return {
      legacyConnectionId: pair.legacy.connectionId,
      legacyState: pair.legacy.state,
      phase: pair.phase,
      blockers: finalizationBlockers(summary.blockers, {
        replacementActive: pair.replacement.state === "ACTIVE",
        qualifiedProofs,
        recovery,
        legacyAccounts,
      }),
      legacyAccessRetired:
        summary.legacyIdentifierCount === 0 &&
        legacyAccounts.remaining === 0 &&
        legacyDirectoryTokens === 0,
    };
  }

  async #loadPair({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId?: string;
  }): Promise<MigrationPair | null> {
    const replacement = await this.#prisma.ssoConnection.findFirst({
      where: {
        organizationId,
        ...(connectionId ? { id: connectionId } : {}),
        replacesConnectionId: { not: null },
        migrationPhase: { not: null },
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      !replacement?.replacesConnectionId ||
      replacement.migrationPhase === null
    )
      return null;
    const legacy = await this.#prisma.ssoConnection.findFirst({
      where: {
        id: replacement.replacesConnectionId,
        organizationId,
        source: "legacy-grandfathered",
      },
    });
    if (!legacy) return null;
    return {
      organizationId,
      replacement: rowToConnection(replacement),
      legacy: rowToConnection(legacy),
      phase: replacement.migrationPhase,
    };
  }

  async #loadSummary(pair: MigrationPair) {
    const { organizationId, replacement, legacy } = pair;
    const [
      members,
      replacementTest,
      lastLegacyAuthentication,
      liveRecoveryCount,
      legacyScim,
      replacementScim,
    ] = await Promise.all([
      this.#memberEvidence(pair),
      this.#prisma.ssoAuthenticationActivity.findFirst({
        where: { organizationId, connectionId: replacement.connectionId },
        orderBy: { authenticatedAt: "desc" },
      }),
      this.#prisma.ssoAuthenticationActivity.findFirst({
        where: { organizationId, connectionId: legacy.connectionId },
        orderBy: { authenticatedAt: "desc" },
      }),
      this.#countUsableRecoveries(organizationId),
      this.#prisma.scimSyncState.findFirst({
        where: { organizationId, connectionId: legacy.connectionId },
      }),
      this.#prisma.scimSyncState.findFirst({
        where: { organizationId, connectionId: replacement.connectionId },
      }),
    ]);
    const { activeCount, linkedCount, sharedLegacyIdentifiers } = members;
    const selectedRoute = routeOf(pair.phase);
    const quietStartMs = Math.max(
      replacement.routeChangedAtMs ??
        replacement.graceStartedAtMs ??
        replacement.createdAtMs,
      lastLegacyAuthentication?.authenticatedAt.getTime() ?? 0,
    );
    const quietComplete =
      this.#now() - quietStartMs >= MIGRATION_QUIET_PERIOD_MS;
    // Tearing the legacy connection down revokes its sync and leaves a REVOKED
    // row behind; a revoked sync pushes nothing, so it is not a sync to repoint.
    const scimStatus = scimStatusOf({
      legacySyncs: legacyScim !== null && legacyScim.state !== "REVOKED",
      replacementSyncState: replacementScim?.state,
    });
    const testSignIn = {
      done: replacementTest !== null,
      atMs: replacementTest?.authenticatedAt.getTime() ?? null,
    };
    return {
      selectedRoute,
      linkedUserIds: members.linkedUserIds,
      verifiedUserIds: members.verifiedUserIds,
      activeCount,
      linkedCount,
      scimStatus,
      testSignIn,
      blockers: migrationBlockers({
        selectedRoute,
        testSignInDone: testSignIn.done,
        liveRecoveryCount,
        linkedCount,
        activeCount,
        quietComplete,
        scimStatus,
        sharedLegacyIdentifiers,
      }),
      legacyIdentifierCount: members.legacyIdentifierCount,
      quietPeriod: {
        lastLegacyAuthenticationAtMs:
          lastLegacyAuthentication?.authenticatedAt.getTime() ?? null,
        complete: quietComplete,
      },
    };
  }

  async #memberEvidence({
    organizationId,
    replacement,
    legacy,
  }: MigrationPair) {
    const members = await this.#prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const candidates = await this.#prisma.identifier.findMany({
      where: {
        userId: { in: members.map(({ userId }) => userId) },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
      },
      select: {
        userId: true,
        state: true,
        connectionId: true,
        providerId: true,
        providerAccountId: true,
      },
    });
    const identifiers = candidates.filter((identifier) =>
      identifierBelongsToMigrationConnection({
        identifier,
        connection: replacement,
      }),
    );
    const legacyIdentifiers = candidates.filter((identifier) =>
      identifierBelongsToMigrationConnection({
        identifier,
        connection: legacy,
      }),
    );
    const linkedUserIds = [...new Set(identifiers.map(({ userId }) => userId))];
    const verifiedUserIds = [
      ...new Set(
        identifiers
          .filter(({ state }) => state === "VERIFIED" || state === "PRIMARY")
          .map(({ userId }) => userId),
      ),
    ];
    const memberWhere = { organizationId, disabledAt: null };
    const [activeCount, linkedCount, sharedLegacyIdentifiers] =
      await Promise.all([
        this.#prisma.organizationUser.count({ where: memberWhere }),
        this.#prisma.organizationUser.count({
          where: { ...memberWhere, userId: { in: linkedUserIds } },
        }),
        this.#hasSharedLegacyIdentifiers(
          organizationId,
          legacyIdentifiers.map(({ userId }) => userId),
        ),
      ]);
    return {
      linkedUserIds,
      verifiedUserIds,
      activeCount,
      linkedCount,
      sharedLegacyIdentifiers,
      legacyIdentifierCount: legacyIdentifiers.length,
    };
  }

  async #countUsableRecoveries(organizationId: string): Promise<number> {
    const holders = await this.#prisma.ssoBreakGlassBinding.findMany({
      where: {
        organizationId,
        supersededAt: null,
        expiresAt: { gt: new Date(this.#now()) },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    return countUsableWaysBackIn({
      holders,
      holdsPassword: this.#holdsPassword,
    });
  }

  async #hasSharedLegacyIdentifiers(
    organizationId: string,
    userIds: string[],
  ): Promise<boolean> {
    if (userIds.length === 0) return false;
    const otherOrganizationIds = await findOtherOrganizationIds({
      prisma: this.#prisma,
      organizationId,
      userIds,
    });
    if (otherOrganizationIds.length === 0) return false;
    return (
      (await this.#prisma.ssoConnection.count({
        where: {
          organizationId: { in: otherOrganizationIds },
          source: "legacy-grandfathered",
          state: { notIn: ["DISCARDED", "TORN_DOWN"] },
        },
      })) > 0
    );
  }

  async #qualifiedProofCount({
    organizationId,
    replacement,
  }: MigrationPair): Promise<number> {
    const domains = replacement.verifiedDomains.filter(
      (domain) =>
        qualifySsoDomainOwnership({ state: replacement, domain }).status ===
        "QUALIFIED",
    );
    if (domains.length === 0) return 0;
    const owned = await this.#prisma.ssoVerifiedDomain.findMany({
      where: { organizationId, domain: { in: domains } },
      select: { domain: true },
    });
    return this.#prisma.ssoVerifiedDomainHolder.count({
      where: {
        organizationId,
        connectionId: replacement.connectionId,
        domain: { in: owned.map(({ domain }) => domain) },
      },
    });
  }

  async #legacyAccounts(
    { organizationId, legacy }: MigrationPair,
    verifiedUserIds: string[],
    activeCount: number,
  ): Promise<LegacyAccountEvidence> {
    // Disabled members still own accounts that must be retired; only readiness counts exclude them.
    const members = await this.#prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const userIds = members.map(({ userId }) => userId);
    const [accounts, identifiers, verifiedDirectMembers] = await Promise.all([
      this.#prisma.account.findMany({
        where: { userId: { in: userIds }, provider: { not: "credential" } },
        select: {
          id: true,
          userId: true,
          provider: true,
          providerAccountId: true,
        },
      }),
      // Detached identifiers still establish which account belongs to this legacy connection.
      this.#prisma.identifier.findMany({
        where: {
          userId: { in: userIds },
          accountId: { not: null },
        },
        select: {
          accountId: true,
          connectionId: true,
          providerId: true,
          providerAccountId: true,
        },
      }),
      this.#prisma.organizationUser.count({
        where: {
          organizationId,
          disabledAt: null,
          userId: { in: verifiedUserIds },
        },
      }),
    ]);
    const matching = accounts.filter((account) =>
      identifierBelongsToMigrationConnection({
        identifier: {
          connectionId: null,
          providerId: account.provider,
          providerAccountId: account.providerAccountId,
        },
        connection: legacy,
      }),
    );
    const ambiguous = await this.#hasSharedLegacyProvider(
      organizationId,
      legacy.idpMetadata.providerId,
      matching.map(({ userId }) => userId),
    );
    const linkedAccountIds = new Set(
      identifiers
        .filter((identifier) =>
          identifierBelongsToMigrationConnection({
            identifier,
            connection: legacy,
          }),
        )
        .map(({ accountId }) => accountId),
    );
    return {
      remaining: matching.length,
      unassociated: matching.filter(({ id }) => !linkedAccountIds.has(id))
        .length,
      ambiguous,
      unverifiedDirectMembers: activeCount - verifiedDirectMembers,
    };
  }

  async #hasSharedLegacyProvider(
    organizationId: string,
    providerId: string | null,
    userIds: string[],
  ): Promise<boolean> {
    const otherOrganizationIds = await findOtherOrganizationIds({
      prisma: this.#prisma,
      organizationId,
      userIds,
    });
    if (otherOrganizationIds.length === 0) return false;

    const otherConnections = await this.#prisma.ssoConnection.findMany({
      where: {
        organizationId: { in: otherOrganizationIds },
        source: "legacy-grandfathered",
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      select: { idpMetadata: true },
    });
    return otherConnections.some(({ idpMetadata }) => {
      const parsed = providerMetadata.safeParse(idpMetadata);
      return parsed.success && parsed.data.providerId === providerId;
    });
  }
}

export async function countUsableWaysBackIn({
  holders,
  holdsPassword,
}: {
  holders: readonly { userId: string }[];
  holdsPassword: (args: { userId: string }) => Promise<boolean>;
}): Promise<number> {
  const usable = await Promise.all(
    holders.map(({ userId }) => holdsPassword({ userId })),
  );
  return usable.filter(Boolean).length;
}
