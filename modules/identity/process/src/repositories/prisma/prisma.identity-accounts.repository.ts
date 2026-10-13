import {
  IdentityIdentifierNotFoundError,
  LIVE_IDENTIFIER_STATES,
} from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate } from "@langwatch/time";

import type {
  IdentityAccountRow,
  IdentityAccounts,
  IdentityAccountSecrets,
} from "../../rules/identity-storage.rules.ts";

/** The `Identifier` columns an assembled account row is built from. */
interface LinkedIdentifierRow {
  userId: string;
  provider: string;
  providerId: string | null;
  issuer: string | null;
  value: string | null;
  accountId: string | null;
  providerAccountId: string | null;
  attachedAt: Date;
}

interface CredentialRow {
  id: string;
  provider: string;
  password: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `AccountCredential` uses better-auth's column names; a patch writes only those it names. */
const CREDENTIAL_COLUMNS = [
  ["password", "password"],
  ["accessToken", "accessToken"],
  ["refreshToken", "refreshToken"],
  ["idToken", "idToken"],
  ["accessTokenExpiresAt", "accessTokenExpiresAt"],
  ["refreshTokenExpiresAt", "refreshTokenExpiresAt"],
  ["scope", "scope"],
] as const;

/** The same secrets on the legacy `Account` row (ADR-116 §4); it has no refresh-expiry column. */
const ACCOUNT_MIRROR_COLUMNS = [
  ["password", "password"],
  ["accessToken", "access_token"],
  ["refreshToken", "refresh_token"],
  ["idToken", "id_token"],
  ["accessTokenExpiresAt", "expires_at"],
  ["scope", "scope"],
] as const;

function patch(
  secrets: IdentityAccountSecrets,
  columns: typeof CREDENTIAL_COLUMNS | typeof ACCOUNT_MIRROR_COLUMNS,
): Record<string, string | Date | null> {
  return Object.fromEntries(
    columns
      .filter(([field]) => field in secrets)
      .map(([field, column]) => {
        const value = secrets[field] ?? null;
        return [column, value === null || typeof value === "string" ? value : toDate(value)];
      }),
  );
}

/**
 * better-auth's `account` model over the two tables that replaced it (ADR-116 §6): `Identifier`
 * says who holds the method, `AccountCredential` (keyed by the pinned `accountId`) its secrets.
 * Only LIVE identifiers assemble: a tombstone would sign someone in through an unlinked account.
 */
export class PrismaIdentityAccountsRepository implements IdentityAccounts {
  static create(database: PrismaClient): PrismaIdentityAccountsRepository {
    return new PrismaIdentityAccountsRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {}

  async findByUser({ userId }: { userId: string }): Promise<IdentityAccountRow[]> {
    return this.assemble(
      await this.database.identifier.findMany({
        where: { userId, state: { in: [...LIVE_IDENTIFIER_STATES] }, accountId: { not: null } },
      }),
    );
  }

  async findByAccountIds({
    accountIds,
  }: {
    accountIds: readonly string[];
  }): Promise<IdentityAccountRow[]> {
    if (accountIds.length === 0) return [];
    return this.assemble(
      await this.database.identifier.findMany({
        where: { accountId: { in: [...accountIds] }, state: { in: [...LIVE_IDENTIFIER_STATES] } },
      }),
    );
  }

  /** Keyed on better-auth's verbatim `providerId`: a subject is unique only within an issuer. */
  async getAccountByProviderSubject({
    userId,
    providerId,
    providerAccountId,
  }: {
    userId: string;
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityAccountRow> {
    const identifier = await this.database.identifier.findFirst({
      where: {
        userId,
        providerId,
        providerAccountId,
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        accountId: { not: null },
      },
    });
    const [row] = identifier === null ? [] : await this.assemble([identifier]);
    if (row === undefined) {
      throw new IdentityIdentifierNotFoundError("no live account for this provider subject");
    }
    return row;
  }

  /** Idempotent on the pinned id: a retried sign-up keeps the first attempt's secrets. */
  async createCredential({
    accountId,
    userId,
    providerId,
    secrets,
  }: {
    accountId: string;
    userId: string;
    providerId: string;
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    await this.database.accountCredential.upsert({
      where: { id: accountId },
      create: {
        id: accountId,
        userId,
        provider: providerId,
        ...patch(secrets, CREDENTIAL_COLUMNS),
      },
      update: {},
    });
  }

  async updateCredentials({
    accountIds,
    secrets,
  }: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    const data = patch(secrets, CREDENTIAL_COLUMNS);
    if (accountIds.length === 0 || Object.keys(data).length === 0) return;
    await this.database.accountCredential.updateMany({
      where: { id: { in: [...accountIds] } },
      data,
    });
  }

  async deleteCredentials({ accountIds }: { accountIds: readonly string[] }): Promise<number> {
    if (accountIds.length === 0) return 0;
    const { count } = await this.database.accountCredential.deleteMany({
      where: { id: { in: [...accountIds] } },
    });
    return count;
  }

  /** `deleteMany`: a row the fold already removed is the expected case, not an error. */
  async deleteBridgeAccounts({ accountIds }: { accountIds: readonly string[] }): Promise<number> {
    if (accountIds.length === 0) return 0;
    const { count } = await this.database.account.deleteMany({
      where: { id: { in: [...accountIds] } },
    });
    return count;
  }

  /** `updateMany`: the fold writes the `Account` row; a row not there yet is a no-op. */
  async mirrorSecretsOntoAccounts({
    accountIds,
    secrets,
  }: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    const data = patch(secrets, ACCOUNT_MIRROR_COLUMNS);
    if (accountIds.length === 0 || Object.keys(data).length === 0) return;
    await this.database.account.updateMany({ where: { id: { in: [...accountIds] } }, data });
  }

  private async assemble(
    identifiers: readonly LinkedIdentifierRow[],
  ): Promise<IdentityAccountRow[]> {
    const accountIds = identifiers.flatMap((identifier) =>
      identifier.accountId === null ? [] : [identifier.accountId],
    );
    if (accountIds.length === 0) return [];
    const credentials = await this.database.accountCredential.findMany({
      where: { id: { in: accountIds } },
    });
    const byAccountId = new Map<string, CredentialRow>(
      credentials.map((credential) => [credential.id, credential]),
    );
    return identifiers.flatMap((identifier) =>
      identifier.accountId === null
        ? []
        : [toAccountRow(identifier, identifier.accountId, byAccountId.get(identifier.accountId))],
    );
  }
}

/**
 * One identifier plus its credential row, as better-auth reads it. An identifier with no
 * credential row still answers (a real method the user holds), its secrets simply absent.
 * `providerId` prefers the unfolded id; the folded `provider` is the last resort.
 */
function toAccountRow(
  identifier: LinkedIdentifierRow,
  accountId: string,
  credential: CredentialRow | undefined,
): IdentityAccountRow {
  const instant = (value: Date | null | undefined) => (value ? fromDate(value) : null);
  return {
    id: accountId,
    userId: identifier.userId,
    providerId: credential?.provider ?? identifier.providerId ?? identifier.provider,
    issuer: identifier.issuer,
    // better-auth's `accountId` is the provider's subject; a credential account's is the mailbox.
    accountId: identifier.providerAccountId ?? identifier.value ?? "",
    password: credential?.password ?? null,
    accessToken: credential?.accessToken ?? null,
    refreshToken: credential?.refreshToken ?? null,
    idToken: credential?.idToken ?? null,
    accessTokenExpiresAt: instant(credential?.accessTokenExpiresAt),
    refreshTokenExpiresAt: instant(credential?.refreshTokenExpiresAt),
    scope: credential?.scope ?? null,
    createdAt: fromDate(credential?.createdAt ?? identifier.attachedAt),
    updatedAt: fromDate(credential?.updatedAt ?? identifier.attachedAt),
  };
}
