import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  MigrationIdentifierHolding,
  SsoAuthenticationRecord,
  SsoMigrationEvidenceRepository,
} from "../sso-migration-evidence.repository.ts";

/** The two models the pair's evidence is read through. */
type PrismaSsoMigrationEvidenceDatabase = Pick<
  PrismaClient,
  "account" | "identifier" | "ssoAuthenticationActivity" | "$queryRaw"
>;

export class PrismaSsoMigrationEvidenceRepository implements SsoMigrationEvidenceRepository {
  static create(
    database: PrismaSsoMigrationEvidenceDatabase,
    newActivityId: () => string,
  ): PrismaSsoMigrationEvidenceRepository {
    return new PrismaSsoMigrationEvidenceRepository(database, newActivityId);
  }

  private constructor(
    private readonly database: PrismaSsoMigrationEvidenceDatabase,
    private readonly newActivityId: () => string,
  ) {}

  async recordAuthentication(record: SsoAuthenticationRecord): Promise<void> {
    await this.database.ssoAuthenticationActivity.create({
      data: {
        id: this.newActivityId(),
        organizationId: record.organizationId,
        connectionId: record.connectionId,
        userId: record.userId,
        authenticatedAt: new Date(record.authenticatedAtMs),
        providerAccountId: record.providerAccountId,
      },
    });
  }

  async findLiveIdentifierHoldings({
    userIds,
  }: {
    userIds: string[];
  }): Promise<MigrationIdentifierHolding[]> {
    if (userIds.length === 0) return [];

    const rows = await this.database.identifier.findMany({
      where: { userId: { in: userIds }, state: { in: [...LIVE_IDENTIFIER_STATES] } },
      select: {
        id: true,
        userId: true,
        state: true,
        provider: true,
        connectionId: true,
        providerId: true,
        providerAccountId: true,
        verifiedAt: true,
      },
    });

    return rows.map(({ id, verifiedAt, ...row }) => ({
      ...row,
      identifierId: id,
      verifiedAtMs: verifiedAt?.getTime() ?? null,
    }));
  }

  async findRecentAuthentications({
    organizationId,
    connectionId,
    limit,
    issuer = null,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
    issuer?: string | null;
  }): Promise<SsoAuthenticationRecord[]> {
    const rows = await this.database.ssoAuthenticationActivity.findMany({
      where: {
        organizationId,
        connectionId,
        ...(await this.throughIssuer({ connectionId, issuer })),
      },
      orderBy: { authenticatedAt: "desc" },
      take: limit,
      select: { userId: true, authenticatedAt: true, providerAccountId: true },
    });

    return rows.map((row) => ({
      organizationId,
      connectionId,
      userId: row.userId,
      authenticatedAtMs: row.authenticatedAt.getTime(),
      providerAccountId: row.providerAccountId,
    }));
  }

  async findLastAuthenticationAtMs({
    organizationId,
    connectionId,
    issuer = null,
  }: {
    organizationId: string;
    connectionId: string;
    issuer?: string | null;
  }): Promise<number | null> {
    const row = await this.database.ssoAuthenticationActivity.findFirst({
      where: {
        organizationId,
        connectionId,
        ...(await this.throughIssuer({ connectionId, issuer })),
      },
      orderBy: { authenticatedAt: "desc" },
      select: { authenticatedAt: true },
    });

    return row?.authenticatedAt.getTime() ?? null;
  }

  /**
   * Leaves out sign-ins whose subject the engine bound under another issuer
   * (the trail carries no issuer, the account row does). A sign-in naming no
   * subject, or an account written before the column, still counts.
   */
  private async throughIssuer({
    connectionId,
    issuer,
  }: {
    connectionId: string;
    issuer: string | null;
  }): Promise<{
    OR?: ({ providerAccountId: null } | { providerAccountId: { notIn: string[] } })[];
  }> {
    if (issuer === null) return {};
    const elsewhere = await this.database.account.findMany({
      // The connection id is the provider, and it belongs to one organization.
      where: { provider: connectionId, issuer: { not: null }, NOT: { issuer } },
      select: { providerAccountId: true },
    });
    if (elsewhere.length === 0) return {};
    return {
      OR: [
        { providerAccountId: null },
        { providerAccountId: { notIn: elsewhere.map((row) => row.providerAccountId) } },
      ],
    };
  }

  async findLastAuthenticationByUser({
    organizationId,
    connectionId,
    userIds,
  }: {
    organizationId: string;
    connectionId: string;
    userIds: string[];
  }): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.database.ssoAuthenticationActivity.findMany({
      where: { organizationId, connectionId, userId: { in: userIds } },
      orderBy: { authenticatedAt: "desc" },
      select: { userId: true, authenticatedAt: true },
    });
    const latest = new Map<string, number>();
    for (const row of rows) {
      // Newest first, so the first one seen per person is theirs.
      if (!latest.has(row.userId)) latest.set(row.userId, row.authenticatedAt.getTime());
    }

    return latest;
  }

  async countAddressHolders({ addresses }: { addresses: string[] }): Promise<Map<string, number>> {
    const lowered = [...new Set(addresses.map((address) => address.toLowerCase()))];
    if (lowered.length === 0) return new Map();

    const rows = await this.database.$queryRaw<{ address: string; holders: bigint }[]>`
      -- @tenancy: an address names one account fleet-wide or it names nobody; only a migrating organization's members' addresses are counted.
      SELECT lower("email") AS "address", count(*) AS "holders"
        FROM "User"
       WHERE lower("email") = ANY(${lowered}::text[])
       GROUP BY 1
    `;
    return new Map(rows.map((row) => [row.address, Number(row.holders)]));
  }
}
