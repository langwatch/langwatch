import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccountsPort,
} from "@langwatch/identity-server/better-auth";
import type { PrismaClient } from "~/generated/prisma/client";

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

/**
 * The secret columns the `AccountCredential` table carries, by better-auth's
 * own canonical name. The table was created with these names so the identity
 * branch needs no field mapping of its own; the list exists so a patch writes
 * only the fields it actually names.
 */
const CREDENTIAL_COLUMNS = [
  "password",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "scope",
] as const;

/**
 * The same secrets, on the legacy `Account` row (ADR-116 §4, forward leg).
 *
 * `refreshTokenExpiresAt` is deliberately absent: better-auth declares the
 * field but the `Account` table has never had a column for it, so the legacy
 * branch has never written one either. Mirroring it would fail the write for
 * a column that holds nothing on either branch today.
 */
const ACCOUNT_MIRROR_COLUMNS = {
  password: "password",
  accessToken: "access_token",
  refreshToken: "refresh_token",
  idToken: "id_token",
  accessTokenExpiresAt: "expires_at",
  scope: "scope",
} as const;

function credentialData(
  secrets: IdentityAccountSecrets,
): Record<string, unknown> {
  return Object.fromEntries(
    CREDENTIAL_COLUMNS.filter((column) => column in secrets).map((column) => [
      column,
      secrets[column] ?? null,
    ]),
  );
}

function accountMirrorData(
  secrets: IdentityAccountSecrets,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(ACCOUNT_MIRROR_COLUMNS)
      .filter(([field]) => field in secrets)
      .map(([field, column]) => [
        column,
        secrets[field as keyof IdentityAccountSecrets] ?? null,
      ]),
  );
}

/**
 * better-auth's `account` model over the two tables that replaced it
 * (ADR-116 §6): `Identifier` says who holds the sign-in method, and
 * `AccountCredential` — keyed by the identifier's pinned `accountId` — says
 * what secrets it carries.
 *
 * Only LIVE identifiers assemble into a row. A tombstone is a sign-in method
 * the user no longer holds, and answering with one would sign somebody in
 * through an account they unlinked.
 */
export class PrismaIdentityAccountsRepository implements IdentityAccountsPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUser({
    userId,
  }: {
    userId: string;
  }): Promise<IdentityAccountRow[]> {
    return this.assemble(
      await this.prisma.identifier.findMany({
        where: {
          userId,
          state: { in: [...LIVE_IDENTIFIER_STATES] },
          accountId: { not: null },
        },
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
      await this.prisma.identifier.findMany({
        where: {
          accountId: { in: [...accountIds] },
          state: { in: [...LIVE_IDENTIFIER_STATES] },
        },
      }),
    );
  }

  /**
   * Keyed on better-auth's own `providerId`, verbatim - the folded
   * `provider` vocabulary collapses every enterprise IdP into `oidc` and a
   * subject is unique only WITHIN an issuer, so it cannot be the match key.
   */
  async findByProviderSubject({
    userId,
    providerId,
    providerAccountId,
  }: {
    userId: string;
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityAccountRow | null> {
    const identifier = await this.prisma.identifier.findFirst({
      where: {
        userId,
        providerId,
        providerAccountId,
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        accountId: { not: null },
      },
    });
    if (identifier === null) return null;
    const [row] = await this.assemble([identifier]);
    return row ?? null;
  }

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
    // Idempotent on the pinned id: a retried sign-up derives the same
    // identifier and therefore the same row, and the second attempt must not
    // overwrite secrets the first one already stored.
    await this.prisma.accountCredential.upsert({
      where: { id: accountId },
      create: {
        id: accountId,
        userId,
        provider: providerId,
        ...credentialData(secrets),
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
    const data = credentialData(secrets);
    if (accountIds.length === 0 || Object.keys(data).length === 0) return;
    await this.prisma.accountCredential.updateMany({
      where: { id: { in: [...accountIds] } },
      data,
    });
  }

  async deleteCredentials({
    accountIds,
  }: {
    accountIds: readonly string[];
  }): Promise<number> {
    if (accountIds.length === 0) return 0;
    const { count } = await this.prisma.accountCredential.deleteMany({
      where: { id: { in: [...accountIds] } },
    });
    return count;
  }

  async deleteBridgeAccounts({
    accountIds,
  }: {
    accountIds: readonly string[];
  }): Promise<number> {
    if (accountIds.length === 0) return 0;
    // `deleteMany`, not `delete`: a row the fold has already removed is the
    // expected case rather than an error.
    const { count } = await this.prisma.account.deleteMany({
      where: { id: { in: [...accountIds] } },
    });
    return count;
  }

  async mirrorSecretsOntoAccounts({
    accountIds,
    secrets,
  }: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    const data = accountMirrorData(secrets);
    if (accountIds.length === 0 || Object.keys(data).length === 0) return;
    // `updateMany`, not `update`: the fold writes the `Account` row and the
    // mirror only re-states its secret columns, so a row that is not there
    // yet is a no-op rather than an error.
    await this.prisma.account.updateMany({
      where: { id: { in: [...accountIds] } },
      data,
    });
  }

  private async assemble(
    identifiers: readonly LinkedIdentifierRow[],
  ): Promise<IdentityAccountRow[]> {
    const accountIds = identifiers
      .map((identifier) => identifier.accountId)
      .filter((accountId): accountId is string => accountId !== null);
    if (accountIds.length === 0) return [];
    const credentials = await this.prisma.accountCredential.findMany({
      where: { id: { in: accountIds } },
    });
    const byAccountId = new Map<string, CredentialRow>(
      credentials.map((credential) => [credential.id, credential]),
    );
    return identifiers.flatMap((identifier) =>
      identifier.accountId === null
        ? []
        : [
            toAccountRow({
              identifier,
              accountId: identifier.accountId,
              credential: byAccountId.get(identifier.accountId) ?? null,
            }),
          ],
    );
  }
}

/**
 * One identifier plus its credential row, as better-auth reads it.
 *
 * An identifier with no credential row still answers — it is a real sign-in
 * method the user holds, and hiding it because the secrets table has not
 * caught up would make a linked account vanish from their settings page. The
 * secrets are simply absent, which is what they are.
 */
function toAccountRow({
  identifier,
  accountId,
  credential,
}: {
  identifier: LinkedIdentifierRow;
  accountId: string;
  credential: CredentialRow | null;
}): IdentityAccountRow {
  return {
    id: accountId,
    userId: identifier.userId,
    // better-auth's own provider id, unfolded. The credential row carries it
    // for a method written on the identity branch and the identifier carries
    // it on the fact (ADR-116); the folded `provider` is the last resort only
    // for a fact stated before either did, since it collapses every generic
    // OAuth and enterprise IdP into `oidc`.
    providerId:
      credential?.provider ?? identifier.providerId ?? identifier.provider,
    // Stated on the attach, never derived: a real OIDC connection's issuer
    // is its own URL. Null only for an identifier attached before the fact
    // carried one, where the adapter falls back to the synthetic form.
    issuer: identifier.issuer,
    // better-auth's `accountId` is the PROVIDER's subject. A credential
    // account's subject is the mailbox, which is the identifier value.
    accountId: identifier.providerAccountId ?? identifier.value ?? "",
    ...secretsOf(credential),
    createdAt: credential?.createdAt ?? identifier.attachedAt,
    updatedAt: credential?.updatedAt ?? identifier.attachedAt,
  };
}

function secretsOf(
  credential: CredentialRow | null,
): Required<IdentityAccountSecrets> {
  return {
    password: credential?.password ?? null,
    accessToken: credential?.accessToken ?? null,
    refreshToken: credential?.refreshToken ?? null,
    idToken: credential?.idToken ?? null,
    accessTokenExpiresAt: credential?.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: credential?.refreshTokenExpiresAt ?? null,
    scope: credential?.scope ?? null,
  };
}
