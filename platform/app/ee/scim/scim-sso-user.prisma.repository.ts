// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AsyncLocalStorage } from "node:async_hooks";

import type {
  SSOUserResolution,
  SSOUserResolutionInput,
} from "@better-auth/sso";
import { extractEmailDomain } from "@ee/sso/matching";
import { rowToConnection } from "@ee/sso/sso-connection-projection.prisma.repository";
import {
  LIVE_IDENTIFIER_STATES,
  normalizeDomain,
  normalizeIdentifierValue,
  qualifySsoDomainOwnership,
  SsoExistingAccountUnconfirmedError,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";

import { env } from "~/env.mjs";
import type { Prisma } from "~/generated/prisma/client";

const CONTINUE = { action: "continue" } as const;
const REFUSE = { action: "reject", code: "OAuthAccountNotLinked" } as const;
const logger = createLogger("langwatch:identity:sso-user-resolution");

/** The refusal for an unconfirmed account this sign-in cannot vouch for,
 *  logged with its cause because the plugin only carries the code onward. */
function refuseUnconfirmed({
  providerId,
  detail,
}: {
  providerId: string;
  detail: string;
}): SSOUserResolution {
  const error = new SsoExistingAccountUnconfirmedError(detail);
  logger.info(
    { code: error.code, providerId },
    `single sign-on link refused: ${detail}`,
  );
  return { action: "reject", code: error.code };
}

/**
 * Selects existing users for admitted SAML or connection-owned SCIM
 * assertions, and, on self-hosted installations, links an OIDC assertion onto
 * an unconfirmed local account on a domain the connection proved.
 */
export class PrismaScimSsoUsers {
  readonly #transactions: AsyncLocalStorage<Prisma.TransactionClient>;
  /** LangWatch Cloud, where anybody may register a password account. */
  readonly #isHosted: () => boolean;

  private constructor(
    transactions: AsyncLocalStorage<Prisma.TransactionClient>,
    isHosted: () => boolean,
  ) {
    this.#transactions = transactions;
    this.#isHosted = isHosted;
  }

  static create(
    transactions: AsyncLocalStorage<Prisma.TransactionClient>,
    { isHosted = () => !!env.IS_SAAS }: { isHosted?: () => boolean } = {},
  ) {
    return new PrismaScimSsoUsers(transactions, isHosted);
  }

  async resolve(input: SSOUserResolutionInput): Promise<SSOUserResolution> {
    const database = this.#transactions.getStore();
    if (!database) {
      throw new Error(
        "SCIM sign-in resolution requires the native identity transaction",
      );
    }

    if (await this.#isDirectoryInactive(database, input)) return REFUSE;

    const email = normalizeIdentifierValue(input.providerUser.email);
    const candidates = await database.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        emailVerified: true,
        deactivatedAt: true,
      },
      take: 2,
    });
    if (candidates.length > 1) return REFUSE;
    const user = candidates[0];
    if (!user) return CONTINUE;

    // SAML supplies a signed email attribute, without an OIDC verification flag.
    // The caller has already admitted that assertion through the domain gate.
    if (input.protocol === "oidc" && !input.providerUser.emailVerified) {
      return this.#resolveUnvouchedAddress(database, input, user);
    }

    if (user.emailVerified) {
      return this.#resolveVerifiedSamlUser(database, input, user);
    }

    if (!(await this.#directoryOwns(database, input.providerId, user.id))) {
      return this.#resolveUnconfirmedUser(database, input, user);
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
   * An OIDC provider that does not assert the address is verified, for an
   * address an account already holds. better-auth refuses the link either
   * way; an unconfirmed account this connection's directory does not own gets
   * the named refusal instead of "account not linked".
   */
  async #resolveUnvouchedAddress(
    database: Prisma.TransactionClient,
    input: SSOUserResolutionInput,
    user: { id: string; emailVerified: boolean },
  ): Promise<SSOUserResolution> {
    if (this.#isHosted() || user.emailVerified) return CONTINUE;
    if (await this.#directoryOwns(database, input.providerId, user.id)) {
      return CONTINUE;
    }
    // A returning person: better-auth signs an existing binding in without
    // asking whether the address was verified, which is what a provider that
    // omits `email_verified` relies on after the first sign-in.
    if (await this.#holdsThisBinding(database, input, user.id)) {
      return CONTINUE;
    }
    return refuseUnconfirmed({
      providerId: input.providerId,
      detail:
        "the provider did not assert the address is verified and the account's address is unconfirmed",
    });
  }

  /** Whether the account already holds this connection's exact subject. */
  async #holdsThisBinding(
    database: Prisma.TransactionClient,
    input: SSOUserResolutionInput,
    userId: string,
  ): Promise<boolean> {
    const binding = await database.account.findFirst({
      where: {
        userId,
        provider: input.providerId,
        issuer: input.accountKey.issuer,
        providerAccountId: input.accountKey.accountId,
      },
      select: { id: true },
    });
    return binding !== null;
  }

  /**
   * An existing account whose address was never confirmed, asserted by an
   * OIDC provider that says the address is verified.
   *
   * On an installation that does not send email a password sign-up can never
   * confirm its address, so better-auth's own rule (link only onto a confirmed
   * address) refuses every such account, the registrant's setup test sign-in
   * included. The link is authorized by the domain instead: this connection
   * has verified the address's domain (DNS record, HTTPS file or licence), so
   * the organization controls every address on it, and its identity provider
   * is vouching for this one. That proves the provider's user owns the
   * address. It does not prove who set the account's existing password, and
   * that password stays usable after the link; the self-hosted scope below is
   * what makes that acceptable. Without the proof, or without the provider's
   * word, the link stays refused (ADR-027).
   *
   * The confirmation written here is uncommitted until the callback ends, so
   * the account-create hook that re-checks the link's evidence has to read
   * inside the same transaction (`PrismaSsoAccountFactsRepository`).
   *
   * An account that already holds this connection's subject is signed in
   * by better-auth as it always was, whatever the proof now says.
   *
   * SELF-HOSTED ONLY. On LangWatch Cloud anybody may register a password
   * account, so a stranger could register an address before its organization
   * verifies the domain and then share the account its owner signs in to.
   * Cloud keeps better-auth's own rule; one operator controls sign-ups on a
   * self-hosted installation.
   */
  async #resolveUnconfirmedUser(
    database: Prisma.TransactionClient,
    input: SSOUserResolutionInput,
    user: { id: string; deactivatedAt: Date | null },
  ): Promise<SSOUserResolution> {
    if (this.#isHosted() || input.protocol !== "oidc") return CONTINUE;
    if (user.deactivatedAt) return REFUSE;
    if (await this.#holdsThisBinding(database, input, user.id)) {
      return CONTINUE;
    }
    if (!(await this.#connectionProvesDomainOf(database, input))) {
      return refuseUnconfirmed({
        providerId: input.providerId,
        detail:
          "the connection has no qualified proof for the unconfirmed account's domain",
      });
    }

    const email = normalizeIdentifierValue(input.providerUser.email);
    const conflict = await database.identifier.findFirst({
      where: {
        userId: { not: user.id },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        OR: [
          { value: { equals: email, mode: "insensitive" } },
          {
            issuer: input.accountKey.issuer,
            providerAccountId: input.accountKey.accountId,
          },
        ],
      },
      select: { id: true },
    });
    if (conflict) return REFUSE;

    // Inside the callback transaction, so a link that fails afterwards rolls
    // this back with it. better-auth confirms the address itself on the links
    // it makes, and skips that for a user selected here.
    await database.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    return { action: "link", userId: user.id, profile: "preserve" };
  }

  /** Whether this connection holds a qualified proof for the asserted
   *  address's domain. A lapsed or incomplete proof does not count. */
  async #connectionProvesDomainOf(
    database: Prisma.TransactionClient,
    input: SSOUserResolutionInput,
  ): Promise<boolean> {
    const raw = extractEmailDomain(input.providerUser.email);
    if (!raw) return false;
    const row = await database.ssoConnection.findUnique({
      where: { id: input.providerId },
    });
    if (!row) return false;
    return (
      qualifySsoDomainOwnership({
        state: rowToConnection(row),
        domain: normalizeDomain(raw),
      }).status === "QUALIFIED"
    );
  }

  /**
   * Whether this connection's directory sync provisioned the user, or the
   * sync of the connection it is replacing did.
   *
   * A person the previous connection's sync pushed, who has never signed in,
   * has no verified address and no account; the directory row is what says
   * the identity provider means them. That row moves to the replacement when
   * the update finishes, and until then the previous connection's ownership
   * is honoured, so they are recognised the same way before and after; both
   * connections belong to the same organization.
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
