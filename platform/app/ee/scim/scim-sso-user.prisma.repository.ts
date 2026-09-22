// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AsyncLocalStorage } from "node:async_hooks";

import type {
  SSOUserResolution,
  SSOUserResolutionInput,
} from "@better-auth/sso";
import {
  LIVE_IDENTIFIER_STATES,
  normalizeIdentifierValue,
} from "@langwatch/identity";

import type { Prisma } from "~/generated/prisma/client";

const CONTINUE = { action: "continue" } as const;
const REFUSE = { action: "reject", code: "OAuthAccountNotLinked" } as const;

/** Selects existing users for admitted SAML or connection-owned SCIM assertions. */
export class PrismaScimSsoUsers {
  readonly #transactions: AsyncLocalStorage<Prisma.TransactionClient>;

  private constructor(
    transactions: AsyncLocalStorage<Prisma.TransactionClient>,
  ) {
    this.#transactions = transactions;
  }

  static create(transactions: AsyncLocalStorage<Prisma.TransactionClient>) {
    return new PrismaScimSsoUsers(transactions);
  }

  async resolve(input: SSOUserResolutionInput): Promise<SSOUserResolution> {
    const database = this.#transactions.getStore();
    if (!database) {
      throw new Error(
        "SCIM sign-in resolution requires the native identity transaction",
      );
    }

    if (await this.#isDirectoryInactive(database, input)) return REFUSE;

    // SAML supplies a signed email attribute, without an OIDC verification flag.
    // The caller has already admitted that assertion through the domain gate.
    if (input.protocol === "oidc" && !input.providerUser.emailVerified) {
      return CONTINUE;
    }

    const email = normalizeIdentifierValue(input.providerUser.email);
    const candidates = await database.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, emailVerified: true, deactivatedAt: true },
      take: 2,
    });
    if (candidates.length > 1) return REFUSE;
    const user = candidates[0];
    if (!user) return CONTINUE;
    if (user.emailVerified) {
      return this.#resolveVerifiedSamlUser(database, input, user);
    }

    if (!(await this.#directoryOwns(database, input.providerId, user.id))) {
      return CONTINUE;
    }

    if (
      user.deactivatedAt ||
      !(await this.#hasActiveMembership(database, input.providerId, user.id))
    ) {
      return REFUSE;
    }
    return this.#resolveOwnedUser(database, input, user.id);
  }

  async #isDirectoryInactive(
    database: Prisma.TransactionClient,
    input: SSOUserResolutionInput,
  ): Promise<boolean> {
    const connection = await database.ssoConnection.findUnique({
      where: { id: input.providerId },
      select: { organizationId: true },
    });
    if (!connection) return false;

    // An existing subject binding still identifies an inactive member when
    // the IdP changes its email claim. Directory profile aliases confer no
    // authority to link a different global account.
    const inactive = await database.scimUserResource.findFirst({
      where: {
        organizationId: connection.organizationId,
        active: false,
        user: {
          OR: [
            {
              email: {
                equals: normalizeIdentifierValue(input.providerUser.email),
                mode: "insensitive",
              },
            },
            {
              accounts: {
                some: {
                  provider: input.providerId,
                  issuer: input.accountKey.issuer,
                  providerAccountId: input.accountKey.accountId,
                },
              },
            },
          ],
        },
      },
      select: { userId: true },
    });
    return inactive !== null;
  }

  async #resolveVerifiedSamlUser(
    database: Prisma.TransactionClient,
    input: SSOUserResolutionInput,
    user: { id: string; deactivatedAt: Date | null },
  ): Promise<SSOUserResolution> {
    if (input.protocol !== "saml") return CONTINUE;
    if (user.deactivatedAt) return REFUSE;
    const userId = user.id;
    const conflict = await database.identifier.findFirst({
      where: {
        userId: { not: userId },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        OR: [
          {
            value: {
              equals: normalizeIdentifierValue(input.providerUser.email),
              mode: "insensitive",
            },
          },
          {
            issuer: input.accountKey.issuer,
            providerAccountId: input.accountKey.accountId,
          },
        ],
      },
      select: { id: true },
    });
    if (conflict) return REFUSE;

    // Native linking rechecks the exact issuer/subject owner and provider.
    // A signed SAML attribute proves this assertion, not local email status.
    return { action: "link", userId, profile: "preserve" };
  }

  /**
   * Whether this connection's directory sync provisioned the user, or the
   * sync of the connection it is replacing did.
   *
   * A person the previous connection's sync pushed, who has never signed in,
   * has no verified address and no account; the directory row is the only
   * thing that says the identity provider means them. That row moves to the
   * replacement when the update finishes, but the update cannot finish until
   * every member has signed in through the replacement. Honouring the
   * previous connection's ownership while the update is on is what lets them
   * sign in at all; both connections belong to the same organization.
   */
  async #directoryOwns(
    database: Prisma.TransactionClient,
    connectionId: string,
    userId: string,
  ): Promise<boolean> {
    const owned = await database.scimDirectoryUser.findUnique({
      where: { connectionId_userId: { connectionId, userId } },
      select: { userId: true },
    });
    if (owned) return true;
    const connection = await database.ssoConnection.findUnique({
      where: { id: connectionId },
      select: { replacesConnectionId: true },
    });
    if (!connection?.replacesConnectionId) return false;
    const inherited = await database.scimDirectoryUser.findUnique({
      where: {
        connectionId_userId: {
          connectionId: connection.replacesConnectionId,
          userId,
        },
      },
      select: { userId: true },
    });
    return inherited !== null;
  }

  async #hasActiveMembership(
    database: Prisma.TransactionClient,
    connectionId: string,
    userId: string,
  ): Promise<boolean> {
    const connection = await database.ssoConnection.findUnique({
      where: { id: connectionId },
      select: { organizationId: true },
    });
    if (!connection) return false;

    const membership = await database.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: connection.organizationId,
        },
      },
      select: { disabledAt: true },
    });
    return membership !== null && membership.disabledAt === null;
  }

  async #resolveOwnedUser(
    database: Prisma.TransactionClient,
    input: SSOUserResolutionInput,
    userId: string,
  ): Promise<SSOUserResolution> {
    const accounts = await database.account.findMany({
      where: {
        OR: [
          { userId },
          {
            issuer: input.accountKey.issuer,
            providerAccountId: input.accountKey.accountId,
          },
        ],
      },
      select: {
        userId: true,
        provider: true,
        issuer: true,
        providerAccountId: true,
      },
    });
    if (accounts.length > 0) {
      const alreadyLinked = accounts.some(
        (account) =>
          account.userId === userId &&
          account.provider === input.providerId &&
          account.issuer === input.accountKey.issuer &&
          account.providerAccountId === input.accountKey.accountId,
      );
      return alreadyLinked
        ? { action: "link", userId, profile: "preserve" }
        : REFUSE;
    }

    if (await this.#hasStoredCredential(database, userId)) return REFUSE;

    const email = normalizeIdentifierValue(input.providerUser.email);
    const identifier = await database.identifier.findFirst({
      where: {
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        // SCIM's bridge records the pending address without proving a way in.
        NOT: {
          userId,
          provider: "email",
          value: { not: null, equals: email, mode: "insensitive" },
          state: "ATTACHED",
          verifiedAt: null,
          accountId: null,
          providerId: null,
          issuer: null,
          providerAccountId: null,
        },
        OR: [
          { userId },
          {
            issuer: input.accountKey.issuer,
            providerAccountId: input.accountKey.accountId,
          },
          {
            value: {
              equals: email,
              mode: "insensitive",
            },
          },
        ],
      },
      select: { id: true },
    });
    if (identifier) return REFUSE;

    return { action: "link", userId, profile: "preserve" };
  }

  async #hasStoredCredential(
    database: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const credential = await database.accountCredential.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (credential) return true;

    const passkey = await database.passkey.findFirst({
      where: { userId },
      select: { id: true },
    });
    return passkey !== null;
  }
}
