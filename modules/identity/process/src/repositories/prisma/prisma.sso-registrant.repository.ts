import { LIVE_IDENTIFIER_STATES, normalizeIdentifierValue } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  SsoAccountKey,
  SsoRegistrantReadRepository,
  SsoResolutionAccount,
  SsoResolutionCandidate,
} from "../sso-registrant.repository.ts";

/** The models the gate's and the user resolver's person questions are read through. */
export type PrismaSsoRegistrantDatabase = Pick<
  PrismaClient,
  "user" | "identifier" | "account" | "accountCredential" | "passkey"
>;

/** An address somebody proved and still holds. `verifiedAt` alone would also
 *  match a DETACHED tombstone — one they proved once and gave up — which
 *  would keep a connection dialable by a surrendered address. */
const HELD_STATES = ["VERIFIED", "PRIMARY"] as const;

export class PrismaSsoRegistrantReadRepository implements SsoRegistrantReadRepository {
  static create(database: PrismaSsoRegistrantDatabase): PrismaSsoRegistrantReadRepository {
    return new PrismaSsoRegistrantReadRepository(database);
  }

  private constructor(private readonly database: PrismaSsoRegistrantDatabase) {}

  /**
   * Two reads rather than one join, and not by preference: `Identifier`
   * carries a bare `userId` with deliberately no foreign key, so a nested
   * `user.identifiers.some` filter is rejected outright by Prisma.
   */
  async holdsAddress({ userId, email }: { userId: string; email: string }): Promise<boolean> {
    const address = email.trim().toLowerCase();
    if (!address) return false;

    const legacy = await this.database.user.findFirst({
      where: { id: userId, email: { equals: address, mode: "insensitive" } },
      select: { id: true },
    });
    if (legacy !== null) return true;

    const identifier = await this.database.identifier.findFirst({
      where: {
        userId,
        // Folded the way the projection folded it when it was written, which
        // is NFKC as well as lower case: a hand-rolled `toLowerCase()` here
        // compares unequal to what the store already normalized, so a unicode
        // homograph would slip past a match that should have hit.
        value: normalizeIdentifierValue(address),
        state: { in: [...HELD_STATES] },
      },
      select: { id: true },
    });
    return identifier !== null;
  }

  async findAccountHolderIds({
    connectionId,
    accountId,
  }: {
    connectionId: string;
    accountId: string;
  }): Promise<string[]> {
    if (!accountId) return [];

    const rows = await this.database.account.findMany({
      where: { provider: connectionId, providerAccountId: accountId },
      select: { userId: true },
      take: 2,
    });
    return rows.map((row) => row.userId);
  }

  async findUsersByEmail({ email }: { email: string }): Promise<SsoResolutionCandidate[]> {
    const rows = await this.database.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, emailVerified: true, deactivatedAt: true },
      take: 2,
    });
    return rows.map((row) => ({
      id: row.id,
      emailVerified: row.emailVerified,
      deactivated: row.deactivatedAt !== null,
    }));
  }

  async findBindingHolderIds({
    connectionId,
    accountKey,
  }: {
    connectionId: string;
    accountKey: SsoAccountKey;
  }): Promise<string[]> {
    const rows = await this.database.account.findMany({
      where: {
        provider: connectionId,
        issuer: accountKey.issuer,
        providerAccountId: accountKey.accountId,
      },
      select: { userId: true },
      take: 2,
    });
    return rows.map((row) => row.userId);
  }

  findAccountsForUserOrSubject({
    userId,
    accountKey,
  }: {
    userId: string;
    accountKey: SsoAccountKey;
  }): Promise<SsoResolutionAccount[]> {
    return this.database.account.findMany({
      where: {
        OR: [{ userId }, { issuer: accountKey.issuer, providerAccountId: accountKey.accountId }],
      },
      select: { userId: true, provider: true, issuer: true, providerAccountId: true },
    });
  }

  async isAddressOrSubjectHeldByAnother({
    userId,
    email,
    accountKey,
  }: {
    userId: string;
    email: string;
    accountKey: SsoAccountKey;
  }): Promise<boolean> {
    const conflict = await this.database.identifier.findFirst({
      where: {
        userId: { not: userId },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        OR: [
          { value: { equals: email, mode: "insensitive" } },
          { issuer: accountKey.issuer, providerAccountId: accountKey.accountId },
        ],
      },
      select: { id: true },
    });
    return conflict !== null;
  }

  async hasStoredCredential({ userId }: { userId: string }): Promise<boolean> {
    const credential = await this.database.accountCredential.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (credential) return true;
    const passkey = await this.database.passkey.findFirst({
      where: { userId },
      select: { id: true },
    });
    return passkey !== null;
  }

  async hasProvingIdentifier({
    userId,
    email,
    accountKey,
  }: {
    userId: string;
    email: string;
    accountKey: SsoAccountKey;
  }): Promise<boolean> {
    const identifier = await this.database.identifier.findFirst({
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
          { issuer: accountKey.issuer, providerAccountId: accountKey.accountId },
          { value: { equals: email, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    return identifier !== null;
  }
}
