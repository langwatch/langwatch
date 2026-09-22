import { LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  MigrationIdentifierHolding,
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
  ): PrismaSsoMigrationEvidenceRepository {
    return new PrismaSsoMigrationEvidenceRepository(database);
  }

  private constructor(private readonly database: PrismaSsoMigrationEvidenceDatabase) {}

  async findLiveIdentifierHoldings({
    userIds,
  }: {
    userIds: string[];
  }): Promise<MigrationIdentifierHolding[]> {
    if (userIds.length === 0) return [];

    return this.database.identifier.findMany({
      where: { userId: { in: userIds }, state: { in: [...LIVE_IDENTIFIER_STATES] } },
      select: {
        userId: true,
        state: true,
        connectionId: true,
        providerId: true,
        providerAccountId: true,
      },
    });
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
