import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  IdentitySignInAccountsRepository,
  LegacySignInAccount,
} from "../identity-signin-accounts.repository.ts";

/** The one model the legacy sign-in answer is read through. */
export type PrismaIdentitySignInAccountsDatabase = Pick<PrismaClient, "user">;

/** better-auth's own provider name for an email-and-password sign-in method. */
const CREDENTIAL_PROVIDER = "credential";
const AUTH0_PROVIDER = "auth0";

/**
 * A credential row with an empty password is a ceremony that never finished,
 * so it is filtered inside Prisma — which keeps every hash on the database's
 * side of this boundary.
 */
const USABLE_METHOD = {
  OR: [
    { provider: { not: CREDENTIAL_PROVIDER } },
    { provider: CREDENTIAL_PROVIDER, password: { not: "" } },
  ],
};

export class PrismaIdentitySignInAccountsRepository implements IdentitySignInAccountsRepository {
  static create(
    database: PrismaIdentitySignInAccountsDatabase,
  ): PrismaIdentitySignInAccountsRepository {
    return new PrismaIdentitySignInAccountsRepository(database);
  }

  private constructor(private readonly database: PrismaIdentitySignInAccountsDatabase) {}

  /**
   * Case-insensitive for the same reason the collision guard is: rows written
   * before addresses were lowercased may carry capitals. A finalized user
   * keeps their credential on `AccountCredential`, so both tables count.
   */
  async findLegacySignInAccounts({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<LegacySignInAccount[]> {
    const user = await this.database.user.findFirst({
      where: { email: { equals: normalizedValue, mode: "insensitive" } },
      select: {
        id: true,
        // The subject rides along for exactly one reader: the connection
        // bridge, which routes an Auth0-brokered row to its own branded
        // button. An opaque identifier, never a secret.
        accounts: { where: USABLE_METHOD, select: { provider: true, providerAccountId: true } },
        accountCredentials: { where: USABLE_METHOD, select: { provider: true } },
        passkeys: { select: { id: true }, take: 1 },
      },
    });
    if (!user) return [];

    const providers = [
      ...user.accounts.map((account) => account.provider),
      ...user.accountCredentials.map((credential) => credential.provider),
    ];

    return [
      {
        userId: user.id,
        methods: {
          hasPassword: providers.includes(CREDENTIAL_PROVIDER),
          hasPasskey: user.passkeys.length > 0,
          providerIds: [
            ...new Set(providers.filter((provider) => provider !== CREDENTIAL_PROVIDER)),
          ],
          connectionIds: [],
        },
        auth0Subjects: user.accounts
          .filter((account) => account.provider === AUTH0_PROVIDER)
          .map((account) => account.providerAccountId),
      },
    ];
  }
}
