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
  arrivalMatchOf,
  connectionRefOf,
  finalizationBlockers,
  identifierBelongsToMigrationConnection,
  inheritedDomainsOf,
  type LegacyAccountEvidence,
  membersViewOf,
  migrationBlockers,
  quietPeriodOf,
  replacementProvesDomain,
  routeOf,
  scimStatusOf,
  strandedUserIdsOf,
} from "./sso-migration.rules";
import type {
  SsoMigrationFinalizationEvidence,
  SsoMigrationFinalizationReadPort,
} from "./sso-migration-finalization.service";
import {
  countAccountsHoldingAddresses,
  findOtherOrganizationIds,
} from "./sso-migration-user-lookups.prisma";
import type { SsoMigrationProgressReadPort } from "./sso-self-serve.service";
import type {
  SelfServeMigrationView,
  SsoMigrationMemberMove,
} from "./sso-self-serve.types";

interface MigrationPair {
  organizationId: string;
  replacement: SsoConnectionState;
  /** The stored row, read the way the link policy reads it at a real arrival. */
  replacementRow: {
    id: string;
    organizationId: string;
    replacesConnectionId: string | null;
    verifiedDomains: string[];
    domainVerifications: unknown;
  };
  legacy: SsoConnectionState;
  phase: SsoMigrationPhase;
}

interface MemberRow {
  userId: string;
  disabledAt: Date | null;
  user: { email: string | null };
}

const isVerifiedState = ({ state }: { state: string }) =>
  state === "VERIFIED" || state === "PRIMARY";

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
          ...summary.members,
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
        this.#legacyAccounts(pair, summary.strandedUserIds),
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
      replacementRow: replacement,
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
    const selectedRoute = routeOf(pair.phase);
    const lastLegacyAuthenticationAtMs =
      lastLegacyAuthentication?.authenticatedAt.getTime() ?? null;
    const quiet = quietPeriodOf({
      switchedOverAtMs:
        selectedRoute === "direct"
          ? (replacement.routeChangedAtMs ??
            replacement.graceStartedAtMs ??
            replacement.createdAtMs)
          : null,
      lastLegacyAuthenticationAtMs,
      nowMs: this.#now(),
    });
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
      members: members.view,
      scimStatus,
      testSignIn,
      blockers: migrationBlockers({
        selectedRoute,
        testSignInDone: testSignIn.done,
        liveRecoveryCount,
        quietComplete: quiet.complete,
        sharedLegacyIdentifiers: members.sharedLegacyIdentifiers,
      }),
      legacyIdentifierCount: members.legacyIdentifierCount,
      strandedUserIds: members.strandedUserIds,
      quietPeriod: { lastLegacyAuthenticationAtMs, ...quiet },
    };
  }

  /**
   * Every member's standing on the replacement: who has signed in through
   * it, and whether it recognises the rest by address. Nobody here holds the
   * update; the people it will not recognise are listed so an administrator
   * knows who will need a hand.
   */
  async #memberEvidence(pair: MigrationPair) {
    const { organizationId, replacement, legacy } = pair;
    const members: MemberRow[] = await this.#prisma.organizationUser.findMany({
      where: { organizationId },
      select: {
        userId: true,
        disabledAt: true,
        user: { select: { email: true } },
      },
    });
    const candidates = await this.#prisma.identifier.findMany({
      where: {
        userId: { in: members.map(({ userId }) => userId) },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
      },
      select: {
        id: true,
        userId: true,
        state: true,
        provider: true,
        connectionId: true,
        providerId: true,
        providerAccountId: true,
      },
    });
    const belongsTo =
      (connection: SsoConnectionState) =>
      (identifier: (typeof candidates)[number]) =>
        identifierBelongsToMigrationConnection({ identifier, connection });
    const legacyIdentifiers = candidates.filter(belongsTo(legacy));
    const linked = new Set(
      candidates
        .filter(belongsTo(replacement))
        .filter(isVerifiedState)
        .map(({ userId }) => userId),
    );
    const stranded = strandedUserIdsOf({
      identifiers: candidates,
      legacyIdentifierIds: new Set(legacyIdentifiers.map(({ id }) => id)),
    });
    const active = members.filter(({ disabledAt }) => disabledAt === null);
    const moves = await this.#movesOf(
      pair,
      active.filter(({ userId }) => !linked.has(userId)),
    );
    return {
      linkedUserIds: [...linked],
      strandedUserIds: stranded,
      view: {
        activeCount: active.length,
        linkedCount: active.filter(({ userId }) => linked.has(userId)).length,
        nextSignInCount: [...moves.values()].filter(
          (move) => move === "matched",
        ).length,
        moves,
      },
      sharedLegacyIdentifiers: await this.#hasSharedLegacyIdentifiers(
        organizationId,
        legacyIdentifiers.map(({ userId }) => userId),
      ),
      // What finishing leaves in place on purpose is not access left behind.
      legacyIdentifierCount: legacyIdentifiers.filter(
        ({ userId }) => !stranded.has(userId),
      ).length,
    };
  }

  /** Whether the replacement recognises each person by address, as a real arrival would be decided. */
  async #movesOf(
    { replacementRow }: MigrationPair,
    people: MemberRow[],
  ): Promise<Map<string, SsoMigrationMemberMove>> {
    const holders = await countAccountsHoldingAddresses({
      prisma: this.#prisma,
      addresses: people.flatMap(({ user }) => (user.email ? [user.email] : [])),
    });
    return new Map(
      people.map(({ userId, user }) => [
        userId,
        arrivalMatchOf({
          email: user.email,
          accountsHoldingAddress: user.email
            ? (holders.get(user.email.toLowerCase()) ?? 0)
            : 0,
          provesDomain: (domain) =>
            replacementProvesDomain({ replacement: replacementRow, domain }),
        }),
      ]),
    );
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
    strandedUserIds: ReadonlySet<string>,
  ): Promise<LegacyAccountEvidence> {
    // Disabled members still own accounts that must be retired; only readiness
    // counts exclude them. Stranded members keep theirs by design.
    const members = await this.#prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const userIds = members
      .map(({ userId }) => userId)
      .filter((userId) => !strandedUserIds.has(userId));
    const [accounts, identifiers] = await Promise.all([
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
