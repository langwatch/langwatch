import {
  LIVE_IDENTIFIER_STATES,
  qualifySsoDomainOwnership,
} from "@langwatch/identity";
import type {
  SelfServeMigrationView,
  SsoMigrationBlockerView,
  SsoMigrationProgressReadPort,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";

const MIGRATION_QUIET_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/** Operational evidence for the customer-visible Auth0 cutover checklist. */
export class PrismaSsoMigrationProgressRepository
  implements SsoMigrationProgressReadPort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => number = Date.now,
  ) {}

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
    const replacementRow = await this.prisma.ssoConnection.findFirst({
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
      !replacementRow?.replacesConnectionId ||
      replacementRow.migrationPhase === null
    ) {
      return null;
    }
    const migrationPhase = replacementRow.migrationPhase;
    const legacyRow = await this.prisma.ssoConnection.findFirst({
      where: {
        id: replacementRow.replacesConnectionId,
        organizationId,
        source: "legacy-grandfathered",
      },
    });
    if (!legacyRow) return null;

    const replacement = rowToConnection(replacementRow);
    const legacy = rowToConnection(legacyRow);
    const liveStates = [...LIVE_IDENTIFIER_STATES];
    const memberWhere = { organizationId, disabledAt: null } as const;
    const linkedWhere = {
      ...memberWhere,
      user: {
        identifiers: {
          some: {
            connectionId: replacement.connectionId,
            state: { in: liveStates },
          },
        },
      },
    } as const;
    const stragglerWhere = {
      ...memberWhere,
      ...(cursor ? { userId: { gt: cursor } } : {}),
      user: {
        identifiers: {
          none: {
            connectionId: replacement.connectionId,
            state: { in: liveStates },
          },
        },
      },
    } as const;

    const [
      activeCount,
      linkedCount,
      stragglerRows,
      replacementTest,
      lastLegacyAuthentication,
      liveRecoveryCount,
      legacyScim,
      replacementScim,
      legacyIdentifiers,
    ] = await Promise.all([
      this.prisma.organizationUser.count({ where: memberWhere }),
      this.prisma.organizationUser.count({ where: linkedWhere }),
      this.prisma.organizationUser.findMany({
        where: stragglerWhere,
        orderBy: { userId: "asc" },
        take: limit + 1,
        select: {
          userId: true,
          user: { select: { name: true, email: true } },
        },
      }),
      this.prisma.ssoAuthenticationActivity.findFirst({
        where: { organizationId, connectionId: replacement.connectionId },
        orderBy: { authenticatedAt: "desc" },
      }),
      this.prisma.ssoAuthenticationActivity.findFirst({
        where: { organizationId, connectionId: legacy.connectionId },
        orderBy: { authenticatedAt: "desc" },
      }),
      this.prisma.ssoBreakGlassBinding.count({
        where: {
          organizationId,
          supersededAt: null,
          expiresAt: { gt: new Date(this.now()) },
        },
      }),
      this.prisma.scimSyncState.findFirst({
        where: { organizationId, connectionId: legacy.connectionId },
      }),
      this.prisma.scimSyncState.findFirst({
        where: { organizationId, connectionId: replacement.connectionId },
      }),
      this.prisma.identifier.findMany({
        where: { connectionId: legacy.connectionId, state: { in: liveStates } },
        distinct: ["userId"],
        select: { userId: true },
      }),
    ]);

    const pageRows = stragglerRows.slice(0, limit);
    const legacyActivityByUser = await this.latestLegacyActivityByUser({
      organizationId,
      connectionId: legacy.connectionId,
      userIds: pageRows.map((row) => row.userId),
    });
    const sharedLegacyIdentifiers = await this.hasSharedLegacyIdentifiers({
      organizationId,
      userIds: legacyIdentifiers.map((identifier) => identifier.userId),
    });
    const selectedRoute =
      replacement.migrationPhase === "SETUP" ||
      replacement.migrationPhase === "GRACE_LEGACY"
        ? "legacy"
        : "direct";
    const quietStartMs = Math.max(
      replacement.routeChangedAtMs ??
        replacement.graceStartedAtMs ??
        replacement.createdAtMs,
      lastLegacyAuthentication?.authenticatedAt.getTime() ?? 0,
    );
    const quietComplete =
      this.now() - quietStartMs >= MIGRATION_QUIET_PERIOD_MS;
    const scimStatus =
      legacyScim === null
        ? "not-applicable"
        : replacementScim?.state === "SYNCING"
          ? "ready"
          : "needs-repointing";
    const testSignIn = replacementTest
      ? { done: true, atMs: replacementTest.authenticatedAt.getTime() }
      : { done: false, atMs: null };
    const blockers: SsoMigrationBlockerView[] = [];

    if (selectedRoute !== "direct") {
      blockers.push({
        code: "direct-route-not-selected",
        message: "Switch normal sign-in to the replacement connection first.",
      });
    }
    if (!testSignIn.done) {
      blockers.push({
        code: "replacement-not-tested",
        message: "Complete a successful test sign-in through the replacement.",
      });
    }
    if (liveRecoveryCount === 0) {
      blockers.push({
        code: "recovery-path-missing",
        message: "Keep at least one live way back in before finalizing.",
      });
    }
    if (linkedCount < activeCount) {
      blockers.push({
        code: "members-not-linked",
        message: `${activeCount - linkedCount} active member${activeCount - linkedCount === 1 ? " is" : "s are"} not linked to the replacement yet.`,
      });
    }
    if (!quietComplete) {
      blockers.push({
        code: "legacy-activity-not-quiet",
        message: "Wait for seven days without a successful legacy sign-in.",
      });
    }
    if (scimStatus === "needs-repointing") {
      blockers.push({
        code: "scim-needs-repointing",
        message:
          "Repoint directory provisioning to the replacement connection.",
      });
    }
    if (sharedLegacyIdentifiers) {
      blockers.push({
        code: "shared-legacy-identifiers",
        message:
          "A legacy identity is shared with another organization and needs review.",
      });
    }

    return {
      legacy: {
        connectionId: legacy.connectionId,
        source: legacy.source,
        providerId: legacy.idpMetadata.providerId,
      },
      replacement: {
        connectionId: replacement.connectionId,
        source: replacement.source,
        providerId: replacement.idpMetadata.providerId,
      },
      phase: migrationPhase,
      selectedRoute,
      inheritedDomains: replacement.domainVerifications
        .filter(
          (proof) =>
            legacy.verifiedDomains.includes(proof.domain) &&
            qualifySsoDomainOwnership({
              state: replacement,
              domain: proof.domain,
            }).status === "QUALIFIED",
        )
        .map((proof) => ({
          domain: proof.domain,
          method: proof.method,
          proofState: proof.proofState,
          evidenceRef: proof.evidenceRef ?? proof.tokenHash,
          verifiedAtMs: proof.verifiedAtMs,
        })),
      testSignIn,
      members: {
        activeCount,
        linkedCount,
        stragglers: pageRows.map((row) => ({
          userId: row.userId,
          name: row.user.name,
          email: row.user.email,
          lastLegacyAuthenticationAtMs:
            legacyActivityByUser.get(row.userId)?.getTime() ?? null,
        })),
        nextCursor:
          stragglerRows.length > limit
            ? (pageRows.at(-1)?.userId ?? null)
            : null,
      },
      quietPeriod: {
        lastLegacyAuthenticationAtMs:
          lastLegacyAuthentication?.authenticatedAt.getTime() ?? null,
        complete: quietComplete,
      },
      scim: { status: scimStatus },
      blockers,
      canFinalize:
        blockers.length === 0 &&
        (replacement.migrationPhase === "GRACE_DIRECT" ||
          replacement.migrationPhase === "FINALIZING"),
    };
  }

  private async latestLegacyActivityByUser({
    organizationId,
    connectionId,
    userIds,
  }: {
    organizationId: string;
    connectionId: string;
    userIds: string[];
  }): Promise<Map<string, Date>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.ssoAuthenticationActivity.findMany({
      where: { organizationId, connectionId, userId: { in: userIds } },
      orderBy: { authenticatedAt: "desc" },
    });
    const latest = new Map<string, Date>();
    for (const row of rows) {
      if (!latest.has(row.userId)) latest.set(row.userId, row.authenticatedAt);
    }
    return latest;
  }

  private async hasSharedLegacyIdentifiers({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<boolean> {
    if (userIds.length === 0) return false;
    const otherMemberships = await this.prisma.organizationUser.findMany({
      where: {
        userId: { in: userIds },
        organizationId: { not: organizationId },
      },
      distinct: ["organizationId"],
      select: { organizationId: true },
    });
    if (otherMemberships.length === 0) return false;
    return (
      (await this.prisma.ssoConnection.count({
        where: {
          organizationId: {
            in: otherMemberships.map((membership) => membership.organizationId),
          },
          source: "legacy-grandfathered",
          state: { notIn: ["DISCARDED", "TORN_DOWN"] },
        },
      })) > 0
    );
  }
}
