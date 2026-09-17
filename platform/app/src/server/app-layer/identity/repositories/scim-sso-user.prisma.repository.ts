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

/** Resolves the first authenticated sign-in of a connection-owned SCIM user. */
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
    if (!user || user.emailVerified) return CONTINUE;

    const ownership = await database.scimDirectoryUser.findUnique({
      where: {
        connectionId_userId: {
          connectionId: input.providerId,
          userId: user.id,
        },
      },
    });
    if (!ownership) return CONTINUE;

    if (
      user.deactivatedAt ||
      !(await this.#hasActiveMembership(database, input.providerId, user.id))
    ) {
      return REFUSE;
    }
    return this.#resolveOwnedUser(database, input, user.id);
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
