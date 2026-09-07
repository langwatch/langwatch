import { isLiveIdentifierState } from "@langwatch/identity";
import {
  type IdentityService,
  type SsoLegacyIdentityRetirementPort,
  SsoMigrationFinalizationBlockedError,
} from "@langwatch/identity-server";
import type { IdentityAccountCeremonies } from "@langwatch/identity-server/better-auth";
import type { PrismaClient } from "~/generated/prisma/client";

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
        revokeForConnection(args: {
          organizationId: string;
          connectionId: string;
        }): Promise<{ revoked: number }>;
      };
      now: () => number;
      newCommandId: () => string;
    },
  ) {}

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
      select: { idpMetadata: true },
    });
    const legacyProviderId = providerIdFrom(legacy?.idpMetadata);
    if (!legacyProviderId) {
      throw blocked(
        "legacy-provider-ambiguous",
        "The legacy connection no longer has an unambiguous provider.",
      );
    }

    const identifiers = await this.deps.prisma.identifier.findMany({
      where: { connectionId: legacyConnectionId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        accountId: true,
        state: true,
      },
    });
    for (const identifier of identifiers) {
      await this.retireIdentifier({
        organizationId,
        legacyProviderId,
        replacementConnectionId,
        actorUserId,
        identifier,
      });
    }
    await this.deps.directories.revokeForConnection({
      organizationId,
      connectionId: legacyConnectionId,
    });
  }

  private async retireIdentifier({
    organizationId,
    legacyProviderId,
    replacementConnectionId,
    actorUserId,
    identifier,
  }: {
    organizationId: string;
    legacyProviderId: string;
    replacementConnectionId: string;
    actorUserId: string;
    identifier: {
      id: string;
      userId: string;
      accountId: string | null;
      state: string;
    };
  }): Promise<void> {
    await this.assertExclusiveToOrganization({
      organizationId,
      userId: identifier.userId,
      legacyProviderId,
    });
    const live = isLiveIdentifierState(identifier.state);
    if (live) {
      await this.ensureReplacementIsWayIn({
        userId: identifier.userId,
        replacementConnectionId,
        legacyIsPrimary: identifier.state === "PRIMARY",
        actorUserId,
      });
    }

    if (identifier.accountId) {
      await this.retireAccount({
        accountId: identifier.accountId,
        userId: identifier.userId,
      });
    }
    if (live) {
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

  private async ensureReplacementIsWayIn({
    userId,
    replacementConnectionId,
    legacyIsPrimary,
    actorUserId,
  }: {
    userId: string;
    replacementConnectionId: string;
    legacyIsPrimary: boolean;
    actorUserId: string;
  }): Promise<void> {
    const replacement = await this.deps.prisma.identifier.findFirst({
      where: {
        userId,
        connectionId: replacementConnectionId,
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
      select: { id: true, state: true },
    });
    if (!replacement) {
      throw blocked(
        "members-not-verified-on-replacement",
        `User ${userId} has no verified replacement identifier.`,
      );
    }
    if (legacyIsPrimary && replacement.state !== "PRIMARY") {
      await this.deps.identity.markPrimary({
        tenantId: userId,
        userId,
        commandId: this.deps.newCommandId(),
        identifierId: replacement.id,
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
    const memberships = await this.deps.prisma.organizationUser.findMany({
      where: { userId, organizationId: { not: organizationId } },
      select: { organizationId: true },
    });
    if (memberships.length === 0) return;
    const connections = await this.deps.prisma.ssoConnection.findMany({
      where: {
        organizationId: {
          in: memberships.map(({ organizationId: id }) => id),
        },
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
