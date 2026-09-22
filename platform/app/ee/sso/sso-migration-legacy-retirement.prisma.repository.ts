// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { isLiveIdentifierState } from "@langwatch/identity";
import type { IdentityService } from "@langwatch/identity-server";
import type { IdentityAccountCeremonies } from "@langwatch/identity-server/better-auth";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  identifierBelongsToMigrationConnection,
  strandedUserIdsOf,
} from "./sso-migration.rules";
import {
  type SsoLegacyIdentityRetirementPort,
  SsoMigrationFinalizationBlockedError,
} from "./sso-migration-finalization.service";
import { findOtherOrganizationIds } from "./sso-other-organization-memberships.prisma";

/** Retires connection-scoped Auth0 identities through their ordinary ceremonies. */
export class PrismaSsoLegacyIdentityRetirement
  implements SsoLegacyIdentityRetirementPort
{
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      identity: IdentityService;
      accounts: IdentityAccountCeremonies;
      directories: {
        moveToConnection(args: {
          organizationId: string;
          fromConnectionId: string;
          toConnectionId: string;
        }): Promise<{ moved: number }>;
      };
      now: () => number;
      newCommandId: () => string;
    },
  ) {}

  /**
   * Takes every member's identity on the previous provider away, except from
   * people for whom it is the only way in: the identity guards refuse to
   * leave anybody with none, so theirs stays, stops working when the previous
   * connection is torn down, and the replacement matches them by address at
   * their next sign-in.
   */
  async retire({
    organizationId,
    legacyConnectionId,
    replacementConnectionId,
    actorUserId,
  }: {
    organizationId: string;
    legacyConnectionId: string;
    replacementConnectionId: string;
    actorUserId: string;
  }): Promise<void> {
    const legacy = await this.deps.prisma.ssoConnection.findFirst({
      where: { id: legacyConnectionId, organizationId },
      select: { idpMetadata: true, source: true },
    });
    const legacyProviderId = providerIdFrom(legacy?.idpMetadata);
    if (!legacyProviderId || legacy?.source !== "legacy-grandfathered") {
      throw blocked(
        "legacy-provider-ambiguous",
        "The legacy connection no longer has an unambiguous provider.",
      );
    }

    const members = await this.deps.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const candidates = await this.deps.prisma.identifier.findMany({
      where: { userId: { in: members.map(({ userId }) => userId) } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        accountId: true,
        state: true,
        provider: true,
        connectionId: true,
        providerId: true,
        providerAccountId: true,
      },
    });
    const legacyIdentifierIds = new Set(
      candidates
        .filter((identifier) =>
          identifierBelongsToMigrationConnection({
            identifier,
            connection: {
              connectionId: legacyConnectionId,
              source: legacy.source,
              idpMetadata: { providerId: legacyProviderId },
            },
          }),
        )
        .map(({ id }) => id),
    );
    const stranded = strandedUserIdsOf({
      identifiers: candidates,
      legacyIdentifierIds,
    });
    for (const identifier of candidates) {
      if (!legacyIdentifierIds.has(identifier.id)) continue;
      if (stranded.has(identifier.userId)) continue;
      await this.retireIdentifier({
        organizationId,
        legacyProviderId,
        actorUserId,
        identifier,
        successor: successorOf({
          identifiers: candidates.filter(
            ({ userId }) => userId === identifier.userId,
          ),
          legacyIdentifierIds,
          replacementConnectionId,
        }),
      });
    }
    // The directory sync LangWatch set up moves across rather than ending:
    // the customer never held its token, so there is nobody to repoint it.
    await this.deps.directories.moveToConnection({
      organizationId,
      fromConnectionId: legacyConnectionId,
      toConnectionId: replacementConnectionId,
    });
  }

  private async retireIdentifier({
    organizationId,
    legacyProviderId,
    actorUserId,
    identifier,
    successor,
  }: {
    organizationId: string;
    legacyProviderId: string;
    actorUserId: string;
    identifier: {
      id: string;
      userId: string;
      accountId: string | null;
      state: string;
    };
    successor: { id: string; state: string } | undefined;
  }): Promise<void> {
    await this.assertExclusiveToOrganization({
      organizationId,
      userId: identifier.userId,
      legacyProviderId,
    });
    // A primary identity is demoted by promoting the way in that stays.
    if (identifier.state === "PRIMARY" && successor?.state === "VERIFIED") {
      await this.deps.identity.markPrimary({
        tenantId: identifier.userId,
        userId: identifier.userId,
        commandId: this.deps.newCommandId(),
        identifierId: successor.id,
        occurredAtMs: this.deps.now(),
        actor: { type: "user", id: actorUserId },
      });
    }
    if (identifier.accountId) {
      await this.retireAccount({
        accountId: identifier.accountId,
        userId: identifier.userId,
      });
    }
    if (isLiveIdentifierState(identifier.state)) {
      await this.deps.identity.detachIdentifier({
        tenantId: identifier.userId,
        userId: identifier.userId,
        commandId: this.deps.newCommandId(),
        identifierId: identifier.id,
        occurredAtMs: this.deps.now(),
        actor: { type: "user", id: actorUserId },
      });
    }
  }

  private async retireAccount({
    accountId,
    userId,
  }: {
    accountId: string;
    userId: string;
  }): Promise<void> {
    const account = await this.deps.prisma.account.findFirst({
      where: { id: accountId, userId },
      select: {
        id: true,
        userId: true,
        provider: true,
        issuer: true,
        providerAccountId: true,
        createdAt: true,
      },
    });
    if (!account) return;

    await this.deps.accounts.beforeAccountDelete({
      id: account.id,
      userId: account.userId,
      providerId: account.provider,
      issuer: account.issuer,
      accountId: account.providerAccountId,
      createdAt: account.createdAt,
    });
    await this.deps.prisma.account.deleteMany({
      where: { id: account.id, userId: account.userId },
    });
  }

  private async assertExclusiveToOrganization({
    organizationId,
    userId,
    legacyProviderId,
  }: {
    organizationId: string;
    userId: string;
    legacyProviderId: string;
  }): Promise<void> {
    const otherOrganizationIds = await findOtherOrganizationIds({
      prisma: this.deps.prisma,
      organizationId,
      userIds: [userId],
    });
    if (otherOrganizationIds.length === 0) return;
    const connections = await this.deps.prisma.ssoConnection.findMany({
      where: {
        organizationId: { in: otherOrganizationIds },
        source: "legacy-grandfathered",
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      select: { idpMetadata: true },
    });
    if (
      connections.some(
        ({ idpMetadata }) => providerIdFrom(idpMetadata) === legacyProviderId,
      )
    ) {
      throw blocked(
        "legacy-provider-ambiguous",
        `User ${userId}'s legacy provider is also active in another organization.`,
      );
    }
  }
}

/** The way in that takes over as primary: the replacement's, else the person's address. */
function successorOf({
  identifiers,
  legacyIdentifierIds,
  replacementConnectionId,
}: {
  identifiers: readonly {
    id: string;
    state: string;
    provider: string;
    connectionId: string | null;
    providerId: string | null;
  }[];
  legacyIdentifierIds: ReadonlySet<string>;
  replacementConnectionId: string;
}) {
  const others = identifiers.filter(
    ({ id, state, provider }) =>
      (state === "VERIFIED" || state === "PRIMARY") &&
      !legacyIdentifierIds.has(id) &&
      provider !== "passkey",
  );
  return (
    others.find(
      ({ connectionId, providerId }) =>
        (connectionId ?? providerId) === replacementConnectionId,
    ) ??
    others.find(({ provider }) => provider === "email") ??
    others[0]
  );
}

function providerIdFrom(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("providerId" in value)) {
    return null;
  }
  const providerId = value.providerId;
  return typeof providerId === "string" ? providerId : null;
}

function blocked(code: string, message: string) {
  return new SsoMigrationFinalizationBlockedError([{ code, message }]);
}
