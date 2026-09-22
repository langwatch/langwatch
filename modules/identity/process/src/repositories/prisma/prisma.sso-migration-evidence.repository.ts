import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  MigrationIdentifierHolding,
  SsoAuthenticationRecord,
  SsoMigrationEvidenceRepository,
} from "../sso-migration-evidence.repository.ts";

/** The two models the pair's evidence is read through. */
export type PrismaSsoMigrationEvidenceDatabase = Pick<
  PrismaClient,
  "identifier" | "ssoAuthenticationActivity"
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
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<SsoAuthenticationRecord[]> {
    const rows = await this.database.ssoAuthenticationActivity.findMany({
      where: { organizationId, connectionId },
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
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<number | null> {
    const row = await this.database.ssoAuthenticationActivity.findFirst({
      where: { organizationId, connectionId },
      orderBy: { authenticatedAt: "desc" },
      select: { authenticatedAt: true },
    });

    return row?.authenticatedAt.getTime() ?? null;
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
}
