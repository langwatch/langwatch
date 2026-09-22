// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  IdentityCommandRefusedError,
  isLiveIdentifierState,
} from "@langwatch/identity";
import type { IdentityService } from "@langwatch/identity-server";
import type { IdentityAccountCeremonies } from "@langwatch/identity-server/better-auth";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  addressFinishingConfirms,
  identifierBelongsToMigrationConnection,
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
        connectionId: true,
        providerId: true,
        providerAccountId: true,
      },
    });
    const identifiers = candidates.filter((identifier) =>
      identifierBelongsToMigrationConnection({
        identifier,
        connection: {
          connectionId: legacyConnectionId,
          source: legacy.source,
          idpMetadata: { providerId: legacyProviderId },
        },
      }),
    );
    const legacyIdentifierIds = identifiers.map(({ id }) => id);
    for (const identifier of identifiers) {
      await this.retireIdentifier({
        organizationId,
        legacyProviderId,
        replacementConnectionId,
        legacyIdentifierIds,
        actorUserId,
        identifier,
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
    replacementConnectionId,
    legacyIdentifierIds,
    actorUserId,
    identifier,
  }: {
    organizationId: string;
    legacyProviderId: string;
    replacementConnectionId: string;
    legacyIdentifierIds: string[];
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
      await this.ensureWayInRemains({
        userId: identifier.userId,
        replacementConnectionId,
        legacyIdentifierIds,
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

  /**
   * Makes sure the person keeps a way in once this identity is gone, and that
   * it is their primary one if this was.
   *
   * The replacement is the way in of choice. A person who has not signed in
   * through it yet keeps any other verified way in, typically their verified
   * address, and the replacement matches them by that address at their next
   * sign-in. Failing both, their unconfirmed address is confirmed on the
   * previous provider's word where its identity proved that same address. A
   * passkey alone is not enough: it has no address behind it. The update's
   * own checks name everybody this refuses before finishing starts; this is
   * the last line, so nobody is ever left without a way in.
   */
  private async ensureWayInRemains({
    userId,
    replacementConnectionId,
    legacyIdentifierIds,
    legacyIsPrimary,
    actorUserId,
  }: {
    userId: string;
    replacementConnectionId: string;
    legacyIdentifierIds: string[];
    legacyIsPrimary: boolean;
    actorUserId: string;
  }): Promise<void> {
    const successor =
      (await this.replacementWayIn({ userId, replacementConnectionId })) ??
      (await this.otherWayIn({ userId, legacyIdentifierIds })) ??
      (await this.confirmedAddressWayIn({
        userId,
        legacyIdentifierIds,
        actorUserId,
      }));
    if (!successor) {
      throw blocked(
        "members-cannot-move-across",
        `User ${userId} can only sign in through the legacy connection.`,
      );
    }
    if (legacyIsPrimary && successor.state !== "PRIMARY") {
      await this.deps.identity.markPrimary({
        tenantId: userId,
        userId,
        commandId: this.deps.newCommandId(),
        identifierId: successor.id,
        occurredAtMs: this.deps.now(),
        actor: { type: "user", id: actorUserId },
      });
    }
  }

  private replacementWayIn({
    userId,
    replacementConnectionId,
  }: {
    userId: string;
    replacementConnectionId: string;
  }) {
    return this.deps.prisma.identifier.findFirst({
      where: {
        userId,
        OR: [
          { connectionId: replacementConnectionId },
          {
            connectionId: null,
            providerId: replacementConnectionId,
            providerAccountId: { not: "" },
          },
        ],
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
      select: { id: true, state: true },
    });
  }

  /** Any other verified way in, the person's own address first. */
  private async otherWayIn({
    userId,
    legacyIdentifierIds,
  }: {
    userId: string;
    legacyIdentifierIds: string[];
  }) {
    const others = await this.deps.prisma.identifier.findMany({
      where: {
        userId,
        id: { notIn: legacyIdentifierIds },
        provider: { not: "passkey" },
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
      select: { id: true, state: true, provider: true },
    });
    return others.find(({ provider }) => provider === "email") ?? others[0];
  }

  /**
   * Confirms the address the previous identity proved, when the person's own
   * address identity holds it unconfirmed, and returns it as their way in.
   * A refusal by the identity guards, typically another account holding the
   * address, means there is no such way in rather than a failed finish.
   */
  private async confirmedAddressWayIn({
    userId,
    legacyIdentifierIds,
    actorUserId,
  }: {
    userId: string;
    legacyIdentifierIds: string[];
    actorUserId: string;
  }) {
    const identifiers = await this.deps.prisma.identifier.findMany({
      where: { userId, state: { in: ["ATTACHED", "VERIFIED", "PRIMARY"] } },
      select: { id: true, provider: true, state: true, value: true },
    });
    const confirm = addressFinishingConfirms({
      identifiers,
      legacyIdentifierIds: new Set(legacyIdentifierIds),
    });
    if (!confirm) return null;
    try {
      await this.deps.identity.verifyIdentifier({
        tenantId: userId,
        userId,
        commandId: this.deps.newCommandId(),
        identifierId: confirm.identifierId,
        verificationId: null,
        method: confirm.method,
        occurredAtMs: this.deps.now(),
        actor: { type: "user", id: actorUserId },
      });
    } catch (error) {
      if (error instanceof IdentityCommandRefusedError) return null;
      throw error;
    }
    return { id: confirm.identifierId, state: "VERIFIED" };
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
