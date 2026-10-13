import { LIVE_IDENTIFIER_STATES, normalizeIdentifierValue } from "@langwatch/identity-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  SsoAccountKey,
  SsoRegistrantReadRepository,
  SsoResolutionAccount,
  SsoResolutionCandidate,
} from "../sso-registrant.repository.ts";

/** The models the gate's and the user resolver's person questions are read through. */
type PrismaSsoRegistrantDatabase = Pick<
  PrismaClient,
  "user" | "identifier" | "account" | "accountCredential" | "passkey" | "$queryRaw"
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
    // Raw so the lower("email") index serves it; Prisma's insensitive `equals` is unindexed ILIKE.
    const rows = await this.database.$queryRaw<
      { id: string; emailVerified: boolean; deactivatedAt: Date | null }[]
    >`
      ${skipTenantCheck({
        // An address or a subject names one person fleet-wide or it names nobody.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT "id", "emailVerified", "deactivatedAt" FROM "User"
      WHERE lower("email") = lower(${email})
      LIMIT 2
    `;
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
    // Raw so the lower("value") index serves the address half; see findUsersByEmail.
    const conflicts = await this.database.$queryRaw<{ id: string }[]>`
      ${skipTenantCheck({
        // An address or a subject names one person fleet-wide or it names nobody.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT "id" FROM "Identifier"
      WHERE "userId" <> ${userId}
        AND "state" IN (${Prisma.join([...LIVE_IDENTIFIER_STATES])})
        AND (
          lower("value") = lower(${email})
          OR ("issuer" = ${accountKey.issuer} AND "providerAccountId" = ${accountKey.accountId})
        )
      LIMIT 1
    `;
    return conflicts.length > 0;
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
    // Raw for the lower("value") index. The NOT excludes the pending address SCIM's bridge
    // records for the person themself, which proves no way in.
    const identifiers = await this.database.$queryRaw<{ id: string }[]>`
      ${skipTenantCheck({
        // An address or a subject names one person fleet-wide or it names nobody.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT "id" FROM "Identifier"
      WHERE "state" IN (${Prisma.join([...LIVE_IDENTIFIER_STATES])})
        AND NOT (
          "userId" = ${userId}
          AND "provider" = 'email'
          AND "value" IS NOT NULL
          AND lower("value") = lower(${email})
          AND "state" = 'ATTACHED'
          AND "verifiedAt" IS NULL
          AND "accountId" IS NULL
          AND "providerId" IS NULL
          AND "issuer" IS NULL
          AND "providerAccountId" IS NULL
        )
        AND (
          "userId" = ${userId}
          OR ("issuer" = ${accountKey.issuer} AND "providerAccountId" = ${accountKey.accountId})
          OR lower("value") = lower(${email})
        )
      LIMIT 1
    `;
    return identifiers.length > 0;
  }
}
