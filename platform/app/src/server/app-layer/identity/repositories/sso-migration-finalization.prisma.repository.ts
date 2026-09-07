import { isSsoProviderMatch } from "@ee/sso/matching";
import {
  LIVE_IDENTIFIER_STATES,
  qualifySsoDomainOwnership,
  ssoConnectionStateSchema,
} from "@langwatch/identity";
import type {
  SsoBreakGlassBindingRepository,
  SsoMigrationFinalizationBlocker,
  SsoMigrationFinalizationEvidence,
  SsoMigrationFinalizationReadPort,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";
import { PrismaSsoMigrationProgressRepository } from "./sso-migration-progress.prisma.repository";

interface LegacyAccountEvidence {
  remaining: number;
  unassociated: number;
  ambiguous: boolean;
  unverifiedDirectMembers: number;
}

interface MatchingLegacyAccount {
  id: string;
  userId: string;
  disabledAt: Date | null;
  otherOrganizations: Array<{ organizationId: string }>;
}

/** Finalization-only evidence layered over the customer-visible progress read. */
export class PrismaSsoMigrationFinalizationRepository
  implements SsoMigrationFinalizationReadPort
{
  private readonly progress: PrismaSsoMigrationProgressRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly recovery: SsoBreakGlassBindingRepository,
    now: () => number = Date.now,
  ) {
    this.progress = new PrismaSsoMigrationProgressRepository(prisma, now);
  }

  async inspect({
    organizationId,
    replacementConnectionId,
  }: {
    organizationId: string;
    replacementConnectionId: string;
  }): Promise<SsoMigrationFinalizationEvidence | null> {
    const view = await this.progress.getProgress({
      organizationId,
      connectionId: replacementConnectionId,
      cursor: null,
      limit: 1,
    });
    if (!view) return null;

    const [replacement, legacy] = await Promise.all([
      this.prisma.ssoConnection.findFirst({
        where: { id: replacementConnectionId, organizationId },
      }),
      this.prisma.ssoConnection.findFirst({
        where: { id: view.legacy.connectionId, organizationId },
        select: { state: true },
      }),
    ]);
    if (!replacement || !legacy) return null;

    const replacementState = rowToConnection(replacement);
    const activeDomains = qualifiedDomains(replacementState);
    const [
      qualifiedProofs,
      liveLegacyIdentifiers,
      legacyAccounts,
      legacyDirectoryTokens,
      recovery,
    ] = await this.readOperationalEvidence({
      organizationId,
      replacementConnectionId,
      legacyConnectionId: view.legacy.connectionId,
      legacyProviderId: view.legacy.providerId,
      activeDomains,
    });
    const blockers = finalizationBlockers(view.blockers, {
      replacementActive: replacementState.state === "ACTIVE",
      qualifiedProofs,
      recovery,
      legacyAccounts,
    });

    return {
      legacyConnectionId: view.legacy.connectionId,
      legacyState: ssoConnectionStateSchema.parse(legacy.state),
      phase: view.phase,
      blockers,
      legacyAccessRetired:
        liveLegacyIdentifiers === 0 &&
        legacyAccounts.remaining === 0 &&
        legacyDirectoryTokens === 0,
    };
  }

  private async readOperationalEvidence({
    organizationId,
    replacementConnectionId,
    legacyConnectionId,
    legacyProviderId,
    activeDomains,
  }: {
    organizationId: string;
    replacementConnectionId: string;
    legacyConnectionId: string;
    legacyProviderId: string;
    activeDomains: string[];
  }): Promise<[number, number, LegacyAccountEvidence, number, boolean]> {
    return await Promise.all([
      this.qualifiedProofCount({
        organizationId,
        replacementConnectionId,
        activeDomains,
      }),
      this.prisma.identifier.count({
        where: {
          connectionId: legacyConnectionId,
          state: { in: [...LIVE_IDENTIFIER_STATES] },
        },
      }),
      this.legacyAccounts({
        organizationId,
        legacyConnectionId,
        legacyProviderId,
        replacementConnectionId,
      }),
      this.prisma.scimToken.count({
        where: { organizationId, connectionId: legacyConnectionId },
      }),
      this.recovery.hasLiveBinding({ organizationId }),
    ]);
  }

  private async qualifiedProofCount({
    organizationId,
    replacementConnectionId,
    activeDomains,
  }: {
    organizationId: string;
    replacementConnectionId: string;
    activeDomains: string[];
  }): Promise<number> {
    if (activeDomains.length === 0) return 0;
    return await this.prisma.ssoVerifiedDomainHolder.count({
      where: {
        connectionId: replacementConnectionId,
        organizationId,
        domain: { in: activeDomains },
        ownership: { is: { organizationId } },
      },
    });
  }

  private async legacyAccounts({
    organizationId,
    legacyConnectionId,
    legacyProviderId,
    replacementConnectionId,
  }: {
    organizationId: string;
    legacyConnectionId: string;
    legacyProviderId: string;
    replacementConnectionId: string;
  }): Promise<LegacyAccountEvidence> {
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: {
        userId: true,
        disabledAt: true,
        user: {
          select: {
            accounts: {
              where: { provider: { not: "credential" } },
              select: { id: true, provider: true, providerAccountId: true },
            },
            orgMemberships: {
              where: { organizationId: { not: organizationId } },
              select: { organizationId: true },
            },
          },
        },
      },
    });
    const matchingAccounts: MatchingLegacyAccount[] = members.flatMap(
      ({ userId, disabledAt, user }) =>
        user.accounts.flatMap((account) =>
          isSsoProviderMatch(
            { ssoProvider: legacyProviderId },
            {
              providerId: account.provider,
              accountId: account.providerAccountId,
            },
          )
            ? [
                {
                  ...account,
                  userId,
                  disabledAt,
                  otherOrganizations: user.orgMemberships,
                },
              ]
            : [],
        ),
    );
    const activeMemberCount = members.filter(
      ({ disabledAt }) => disabledAt === null,
    ).length;
    const [linkedAccountIds, ambiguous, verifiedDirectMembers] =
      await Promise.all([
        this.linkedLegacyAccountIds({
          legacyConnectionId,
          userIds: members.map(({ userId }) => userId),
        }),
        this.hasAmbiguousProvider({ matchingAccounts, legacyProviderId }),
        this.verifiedDirectMemberCount({
          organizationId,
          replacementConnectionId,
        }),
      ]);

    return {
      remaining: matchingAccounts.length,
      unassociated: matchingAccounts.filter(
        ({ id }) => !linkedAccountIds.has(id),
      ).length,
      ambiguous,
      unverifiedDirectMembers: activeMemberCount - verifiedDirectMembers,
    };
  }

  private async linkedLegacyAccountIds({
    legacyConnectionId,
    userIds,
  }: {
    legacyConnectionId: string;
    userIds: string[];
  }): Promise<Set<string>> {
    const identifiers = await this.prisma.identifier.findMany({
      where: {
        connectionId: legacyConnectionId,
        userId: { in: userIds },
        accountId: { not: null },
      },
      select: { accountId: true },
    });
    return new Set(
      identifiers.flatMap(({ accountId }) =>
        accountId === null ? [] : [accountId],
      ),
    );
  }

  private async hasAmbiguousProvider({
    matchingAccounts,
    legacyProviderId,
  }: {
    matchingAccounts: MatchingLegacyAccount[];
    legacyProviderId: string;
  }): Promise<boolean> {
    const organizationIds = [
      ...new Set(
        matchingAccounts.flatMap(({ otherOrganizations }) =>
          otherOrganizations.map(({ organizationId }) => organizationId),
        ),
      ),
    ];
    if (organizationIds.length === 0) return false;
    const connections = await this.prisma.ssoConnection.findMany({
      where: {
        organizationId: { in: organizationIds },
        source: "legacy-grandfathered",
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      select: { organizationId: true, idpMetadata: true },
    });
    return matchingAccounts.some(({ otherOrganizations }) =>
      connections.some(
        (connection) =>
          otherOrganizations.some(
            ({ organizationId }) =>
              organizationId === connection.organizationId,
          ) && legacyProviderFrom(connection.idpMetadata) === legacyProviderId,
      ),
    );
  }

  private async verifiedDirectMemberCount({
    organizationId,
    replacementConnectionId,
  }: {
    organizationId: string;
    replacementConnectionId: string;
  }): Promise<number> {
    return await this.prisma.organizationUser.count({
      where: {
        organizationId,
        disabledAt: null,
        user: {
          identifiers: {
            some: {
              connectionId: replacementConnectionId,
              state: { in: ["VERIFIED", "PRIMARY"] },
            },
          },
        },
      },
    });
  }
}

function qualifiedDomains(state: ReturnType<typeof rowToConnection>): string[] {
  return state.verifiedDomains.filter(
    (domain) =>
      qualifySsoDomainOwnership({ state, domain }).status === "QUALIFIED",
  );
}

function finalizationBlockers(
  current: readonly SsoMigrationFinalizationBlocker[],
  evidence: {
    replacementActive: boolean;
    qualifiedProofs: number;
    recovery: boolean;
    legacyAccounts: LegacyAccountEvidence;
  },
): SsoMigrationFinalizationBlocker[] {
  const blockers = [...current];
  if (!evidence.replacementActive) {
    addBlocker(blockers, {
      code: "replacement-not-active",
      message: "Activate the replacement connection before finalizing.",
    });
  }
  if (evidence.qualifiedProofs === 0) {
    addBlocker(blockers, {
      code: "domain-ownership-proof-missing",
      message:
        "The replacement no longer holds a current organization-owned domain proof.",
    });
  }
  if (!evidence.recovery) {
    addBlocker(blockers, {
      code: "recovery-path-missing",
      message:
        "A live break-glass binding and a configured local sign-in method are required.",
    });
  }
  if (evidence.legacyAccounts.ambiguous) {
    addBlocker(blockers, {
      code: "legacy-provider-ambiguous",
      message:
        "A legacy account is also in scope for another organization's provider.",
    });
  }
  if (evidence.legacyAccounts.unassociated > 0) {
    addBlocker(blockers, {
      code: "legacy-account-association-ambiguous",
      message:
        "A legacy account has no connection-scoped identifier and needs review.",
    });
  }
  if (evidence.legacyAccounts.unverifiedDirectMembers > 0) {
    addBlocker(blockers, {
      code: "members-not-verified-on-replacement",
      message:
        "Every current member must hold a verified replacement identifier before legacy access is removed.",
    });
  }
  return blockers;
}

function legacyProviderFrom(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("providerId" in value)) {
    return null;
  }
  const providerId = value.providerId;
  return typeof providerId === "string" ? providerId : null;
}

function addBlocker(
  blockers: SsoMigrationFinalizationBlocker[],
  blocker: SsoMigrationFinalizationBlocker,
): void {
  if (!blockers.some(({ code }) => code === blocker.code)) {
    blockers.push(blocker);
  }
}
