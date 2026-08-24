import type {
  AccountCredentialPatch,
  AccountCredentialRow,
  AccountCredentialsRepository,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

type Row = {
  id: string;
  identifierId: string;
  type: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  password: string | null;
  scope: string | null;
  tokenType: string | null;
  sessionState: string | null;
  expiresAt: Date | null;
  extExpiresIn: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(row: Row): AccountCredentialRow {
  return {
    id: row.id,
    identifierId: row.identifierId,
    type: row.type,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    idToken: row.idToken,
    password: row.password,
    scope: row.scope,
    tokenType: row.tokenType,
    sessionState: row.sessionState,
    expiresAtMs: row.expiresAt?.getTime() ?? null,
    extExpiresIn: row.extExpiresIn,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  };
}

/** Only the fields the patch actually names — absent means "leave alone". */
function toPrismaPatch(patch: AccountCredentialPatch) {
  const data: Record<string, unknown> = {};
  if ("accessToken" in patch) data.accessToken = patch.accessToken;
  if ("refreshToken" in patch) data.refreshToken = patch.refreshToken;
  if ("idToken" in patch) data.idToken = patch.idToken;
  if ("password" in patch) data.password = patch.password;
  if ("scope" in patch) data.scope = patch.scope;
  if ("tokenType" in patch) data.tokenType = patch.tokenType;
  if ("sessionState" in patch) data.sessionState = patch.sessionState;
  if ("type" in patch) data.type = patch.type;
  if ("extExpiresIn" in patch) data.extExpiresIn = patch.extExpiresIn;
  if ("expiresAtMs" in patch) {
    data.expiresAt =
      patch.expiresAtMs == null ? null : new Date(patch.expiresAtMs);
  }
  return data;
}

/**
 * `AccountCredential` over Prisma (ADR-116). Secrets only: this repository
 * never learns which user a row belongs to, because that is the identifier's
 * to say and asking here would put the linkage back in two places.
 */
export class PrismaAccountCredentialsRepository
  implements AccountCredentialsRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById({ id }: { id: string }): Promise<AccountCredentialRow | null> {
    const row = await this.prisma.accountCredential.findUnique({
      where: { id },
    });
    return row ? toRow(row) : null;
  }

  async findByIdentifierIds({
    identifierIds,
  }: {
    identifierIds: string[];
  }): Promise<AccountCredentialRow[]> {
    if (identifierIds.length === 0) return [];
    const rows = await this.prisma.accountCredential.findMany({
      where: { identifierId: { in: identifierIds } },
    });
    return rows.map(toRow);
  }

  async create(
    row: Omit<AccountCredentialRow, "createdAtMs" | "updatedAtMs">,
  ): Promise<void> {
    // Idempotent on the id the ceremony derived: a retried sign-up derives
    // the same identifier and therefore the same row, and the second attempt
    // must not overwrite tokens the first one already stored.
    await this.prisma.accountCredential.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        identifierId: row.identifierId,
        type: row.type,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        idToken: row.idToken,
        password: row.password,
        scope: row.scope,
        tokenType: row.tokenType,
        sessionState: row.sessionState,
        expiresAt:
          row.expiresAtMs == null ? null : new Date(row.expiresAtMs),
        extExpiresIn: row.extExpiresIn,
      },
      update: {},
    });
  }

  async update({
    id,
    patch,
  }: {
    id: string;
    patch: AccountCredentialPatch;
  }): Promise<void> {
    const data = toPrismaPatch(patch);
    if (Object.keys(data).length === 0) return;
    await this.prisma.accountCredential.updateMany({ where: { id }, data });
  }

  async updateMany({
    ids,
    patch,
  }: {
    ids: string[];
    patch: AccountCredentialPatch;
  }): Promise<number> {
    if (ids.length === 0) return 0;
    const data = toPrismaPatch(patch);
    if (Object.keys(data).length === 0) return 0;
    const result = await this.prisma.accountCredential.updateMany({
      where: { id: { in: ids } },
      data,
    });
    return result.count;
  }

  async deleteByIds({ ids }: { ids: string[] }): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.accountCredential.deleteMany({
      where: { id: { in: ids } },
    });
    return result.count;
  }
}
