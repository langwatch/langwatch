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
  addressFinishingConfirms,
  connectionRefOf,
  finalizationBlockers,
  identifierBelongsToMigrationConnection,
  inheritedDomainsOf,
  type LegacyAccountEvidence,
  memberMoveOf,
  membersViewOf,
  migrationBlockers,
  quietPeriodOf,
  routeOf,
  scimStatusOf,
} from "./sso-migration.rules";
import {
  arrivalMatchOf,
  replacementProvesDomain,
  type SsoArrivalMatch,
} from "./sso-migration-arrival";
import type {
  SsoMigrationFinalizationEvidence,
  SsoMigrationFinalizationReadPort,
} from "./sso-migration-finalization.service";
import { findOtherOrganizationIds } from "./sso-other-organization-memberships.prisma";
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
  user: { email: string | null; emailVerified: boolean };
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
        this.#legacyAccounts(pair),
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
        waitingCount: members.view.waitingCount,
        deactivatedOnPreviousCount: members.view.deactivatedOnPreviousCount,
        quietComplete: quiet.complete,
        sharedLegacyIdentifiers: members.sharedLegacyIdentifiers,
      }),
      legacyIdentifierCount: members.legacyIdentifierCount,
      quietPeriod: { lastLegacyAuthenticationAtMs, ...quiet },
    };
  }

  /**
   * Every member's standing on the replacement, and what moving each one
   * still needs.
   *
   * Deactivated members are read too: they cannot sign in, so nobody has to
   * match them, but finishing still takes their previous identity away and
   * must not leave them with none.
   */
  async #memberEvidence(pair: MigrationPair) {
    const { organizationId, replacement, legacy } = pair;
    const members: MemberRow[] = await this.#prisma.organizationUser.findMany({
      where: { organizationId },
      select: {
        userId: true,
        disabledAt: true,
        user: { select: { email: true, emailVerified: true } },
      },
    });
    const candidates = await this.#liveIdentifiersOf(members);
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
    const previousIsOnlyWayIn = previousOnlyWayInOf({
      candidates,
      legacyIdentifiers,
      confirmable: await this.#addressesFinishingConfirms({
        members,
        candidates,
        legacyIdentifiers,
      }),
    });
    const unmoved = members.filter(({ userId }) => !linked.has(userId));
    const moves = await this.#movesOf({
      pair,
      people: unmoved.filter(({ disabledAt }) => disabledAt === null),
      previousIsOnlyWayIn,
    });
    const nextSignInCount = [...moves.values()].filter(
      (move) => move === "next-sign-in",
    ).length;
    const active = members.filter(({ disabledAt }) => disabledAt === null);
    return {
      linkedUserIds: [...linked],
      view: {
        activeCount: active.length,
        linkedCount: active.filter(({ userId }) => linked.has(userId)).length,
        nextSignInCount,
        waitingCount: moves.size - nextSignInCount,
        deactivatedOnPreviousCount: unmoved.filter(
          ({ userId, disabledAt }) =>
            disabledAt !== null && previousIsOnlyWayIn.has(userId),
        ).length,
        moves,
      },
      sharedLegacyIdentifiers: await this.#hasSharedLegacyIdentifiers(
        organizationId,
        legacyIdentifiers.map(({ userId }) => userId),
      ),
      legacyIdentifierCount: legacyIdentifiers.length,
    };
  }

  #liveIdentifiersOf(members: readonly { userId: string }[]) {
    return this.#prisma.identifier.findMany({
      where: {
        userId: { in: members.map(({ userId }) => userId) },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
      },
      select: {
        id: true,
        userId: true,
        state: true,
        provider: true,
        value: true,
        connectionId: true,
        providerId: true,
        providerAccountId: true,
      },
    });
  }

  /** What moving each active member who has not moved across still needs. */
  async #movesOf({
    pair,
    people,
    previousIsOnlyWayIn,
  }: {
    pair: MigrationPair;
    people: MemberRow[];
    previousIsOnlyWayIn: ReadonlySet<string>;
  }): Promise<Map<string, SsoMigrationMemberMove>> {
    const arrivals = await this.#arrivalsOf(pair, people);
    return new Map(
      people.map(({ userId }) => [
        userId,
        memberMoveOf({
          arrival: arrivals.get(userId) ?? "unverified-address",
          previousIsOnlyWayIn: previousIsOnlyWayIn.has(userId),
        }),
      ]),
    );
  }

  /** How the replacement would match each person arriving through it today. */
  async #arrivalsOf(
    { replacement, replacementRow, legacy }: MigrationPair,
    people: MemberRow[],
  ): Promise<Map<string, SsoArrivalMatch>> {
    if (people.length === 0) return new Map();
    const [directoryRows, holders] = await Promise.all([
      this.#prisma.scimDirectoryUser.findMany({
        where: {
          userId: { in: people.map(({ userId }) => userId) },
          connectionId: {
            in: [replacement.connectionId, legacy.connectionId],
          },
        },
        select: { userId: true },
      }),
      this.#accountsHoldingAddresses(
        people.flatMap(({ user }) =>
          user.email ? [user.email.toLowerCase()] : [],
        ),
      ),
    ]);
    const provisioned = new Set(directoryRows.map(({ userId }) => userId));
    return new Map(
      people.map(({ userId, user }) => [
        userId,
        arrivalMatchOf({
          email: user.email,
          vouchedFor: user.emailVerified || provisioned.has(userId),
          accountsHoldingAddress: user.email
            ? (holders.get(user.email.toLowerCase()) ?? 0)
            : 0,
          provesDomain: (domain) =>
            replacementProvesDomain({ replacement: replacementRow, domain }),
        }),
      ]),
    );
  }

  /**
   * The people whose address finishing confirms in place of their identity
   * on the previous provider.
   *
   * Only where no other account holds the address: confirming an address
   * somebody else holds is refused by the identity guards, and finishing
   * would stop on it half way.
   */
  async #addressesFinishingConfirms({
    members,
    candidates,
    legacyIdentifiers,
  }: {
    members: MemberRow[];
    candidates: readonly {
      id: string;
      userId: string;
      provider: string;
      state: string;
      value: string | null;
    }[];
    legacyIdentifiers: readonly { id: string }[];
  }): Promise<Set<string>> {
    const legacyIdentifierIds = new Set(legacyIdentifiers.map(({ id }) => id));
    const confirmed = new Map<string, string>();
    for (const [userId, identifiers] of Map.groupBy(
      candidates,
      (identifier) => identifier.userId,
    )) {
      const confirm = addressFinishingConfirms({
        identifiers,
        legacyIdentifierIds,
      });
      const address = identifiers.find(
        ({ id }) => id === confirm?.identifierId,
      )?.value;
      if (address) confirmed.set(userId, address.toLowerCase());
    }
    const holders = await this.#accountsHoldingAddresses([
      ...new Set(confirmed.values()),
    ]);
    const ownAddress = new Map(
      members.map(({ userId, user }) => [userId, user.email?.toLowerCase()]),
    );
    return new Set(
      [...confirmed]
        .filter(
          ([userId, address]) =>
            (holders.get(address) ?? 0) ===
            (ownAddress.get(userId) === address ? 1 : 0),
        )
        .map(([userId]) => userId),
    );
  }

  /** How many accounts hold each address, compared without case. */
  async #accountsHoldingAddresses(
    addresses: string[],
  ): Promise<Map<string, number>> {
    if (addresses.length === 0) return new Map();
    const rows = await this.#prisma.$queryRaw<
      { address: string; holders: bigint }[]
    >`
      -- @tenancy: an address names one account fleet-wide or it names nobody; only this organization's members' addresses are counted
      SELECT lower("email") AS "address", count(*) AS "holders"
      FROM "User"
      WHERE lower("email") = ANY(${addresses}::text[])
      GROUP BY 1
    `;
    return new Map(rows.map((row) => [row.address, Number(row.holders)]));
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

  async #legacyAccounts({
    organizationId,
    legacy,
  }: MigrationPair): Promise<LegacyAccountEvidence> {
    // Disabled members still own accounts that must be retired; only readiness counts exclude them.
    const members = await this.#prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const userIds = members.map(({ userId }) => userId);
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

/**
 * The people whose only verified way in is an identity on the previous
 * provider, and whose address finishing cannot confirm in its place, so
 * finishing would leave them none.
 *
 * A passkey does not count as another way in: it has no address behind it,
 * and the identity guards refuse to leave anybody holding passkeys alone.
 */
function previousOnlyWayInOf({
  candidates,
  legacyIdentifiers,
  confirmable,
}: {
  confirmable: ReadonlySet<string>;
  candidates: readonly {
    id: string;
    userId: string;
    state: string;
    provider: string;
  }[];
  legacyIdentifiers: readonly { id: string; userId: string; state: string }[];
}): Set<string> {
  const legacyIds = new Set(legacyIdentifiers.map(({ id }) => id));
  const otherWayIn = new Set(
    candidates
      .filter(
        (identifier) =>
          isVerifiedState(identifier) &&
          !legacyIds.has(identifier.id) &&
          identifier.provider !== "passkey",
      )
      .map(({ userId }) => userId),
  );
  // An unconfirmed identity was never a way in, so taking it away strands nobody.
  return new Set(
    legacyIdentifiers
      .filter(isVerifiedState)
      .map(({ userId }) => userId)
      .filter((userId) => !otherWayIn.has(userId) && !confirmable.has(userId)),
  );
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
