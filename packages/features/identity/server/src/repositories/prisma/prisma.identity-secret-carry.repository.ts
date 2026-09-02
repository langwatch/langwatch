import type { AccountSecretPair, IdentitySecretCarryRepository } from "../../identity-secret-carry.service";
import type { IdentityAccountSecrets } from "../../better-auth/storage-ports";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The `Account` row's secret columns, by the canonical name
 * `AccountCredential` stores them under. The legacy table is NextAuth's, so
 * four of the six are renamed across the copy.
 *
 * `refreshTokenExpiresAt` has no `Account` column and never did, so there is
 * nothing to carry or heal for it — the legacy branch has never written one.
 */
const CARRIED_COLUMNS = {
  password: "password",
  accessToken: "access_token",
  refreshToken: "refresh_token",
  idToken: "id_token",
  accessTokenExpiresAt: "expires_at",
  scope: "scope",
} as const;

interface LegacyAccountRow {
  id: string;
  userId: string;
  provider: string;
  password: string | null;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  expires_at: Date | null;
  scope: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The reads and writes behind both pass-time directions of the bridge
 * mirror (ADR-116 §4): carrying a latching user's secrets across, and
 * healing back a secret that landed on the legacy branch afterwards.
 *
 * `Account`, `AccountCredential` and `Identifier` are identity tables under
 * the multitenancy middleware's exemption, so none of these queries carries
 * a `projectId` — none of the models has one.
 *
 * The `updatedAt` comparison itself is NOT done here. It reads as one line
 * of SQL and it is the rule the whole feature turns on, so it lives in the
 * service where it can be read and tested; this port hands over both
 * timestamps and does what it is told.
 */
export class PrismaIdentitySecretCarryRepository
  implements IdentitySecretCarryRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAccountSecretPairs({
    userId,
  }: {
    userId: string;
  }): Promise<AccountSecretPair[]> {
    const accounts = (await this.prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        userId: true,
        provider: true,
        password: true,
        access_token: true,
        refresh_token: true,
        id_token: true,
        expires_at: true,
        scope: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as LegacyAccountRow[];
    if (accounts.length === 0) return [];

    const credentials = await this.prisma.accountCredential.findMany({
      where: { id: { in: accounts.map((account) => account.id) } },
      select: { id: true, updatedAt: true },
    });
    const credentialUpdatedAt = new Map(
      credentials.map((credential) => [
        credential.id,
        credential.updatedAt.getTime(),
      ]),
    );

    return accounts.map((account) => ({
      accountId: account.id,
      userId: account.userId,
      // better-auth's own provider id, verbatim: `Identifier.provider` folds
      // every generic OAuth IdP into `oidc`, so it cannot stand in here.
      providerId: account.provider,
      accountCreatedAtMs: account.createdAt.getTime(),
      accountUpdatedAtMs: account.updatedAt.getTime(),
      credentialUpdatedAtMs: credentialUpdatedAt.get(account.id) ?? null,
      secrets: secretsOf(account),
    }));
  }

  /**
   * Idempotent by construction: keyed on the pinned account id, a row that
   * already exists is left exactly as it is. Running the carry again inserts
   * nothing, which is what makes it safe on every pass.
   *
   * The timestamps are the `Account` row's own, not `now()`. They are what
   * every later comparison reads, so stamping the copy with the time of the
   * copy would make the credential row claim to be newer than the secret it
   * holds — and the heal leg would then never fire for it again.
   */
  async insertCredentialIfMissing({
    accountId,
    userId,
    providerId,
    secrets,
    createdAtMs,
    updatedAtMs,
  }: {
    accountId: string;
    userId: string;
    providerId: string;
    secrets: IdentityAccountSecrets;
    createdAtMs: number;
    updatedAtMs: number;
  }): Promise<boolean> {
    const created = await this.prisma.accountCredential.createMany({
      data: [
        {
          id: accountId,
          userId,
          provider: providerId,
          ...secrets,
          createdAt: new Date(createdAtMs),
          updatedAt: new Date(updatedAtMs),
        },
      ],
      skipDuplicates: true,
    });
    return created.count > 0;
  }

  async overwriteCredential({
    accountId,
    secrets,
    updatedAtMs,
  }: {
    accountId: string;
    secrets: IdentityAccountSecrets;
    updatedAtMs: number;
  }): Promise<void> {
    await this.prisma.accountCredential.updateMany({
      where: { id: accountId },
      // The `Account` row's own `updatedAt` rides along, so the comparison
      // settles at equal and the next pass writes nothing.
      data: { ...secrets, updatedAt: new Date(updatedAtMs) },
    });
  }
}

function secretsOf(account: LegacyAccountRow): IdentityAccountSecrets {
  return Object.fromEntries(
    Object.entries(CARRIED_COLUMNS).map(([canonical, column]) => [
      canonical,
      account[column as keyof LegacyAccountRow] ?? null,
    ]),
  ) as IdentityAccountSecrets;
}
