import { reproofTargetsOf } from "../../rules/sso-domain-reproof-targets.rules.ts";
import type {
  SsoDomainReproofTarget,
  SsoDomainReproofTargetRepository,
} from "../sso-domain-reproof.repository.ts";

/** One `SsoConnection` row as the rotation reads it, and no other column. */
interface ProvedConnectionRow {
  id: string;
  organizationId: string;
  verifiedDomains: string[];
  domainVerifications: unknown;
}

/**
 * The two models the sweep's rotation touches, spelled as the operations it
 * runs: the whole typed client satisfies this, and so does a stand-in with
 * these signatures — which is what lets the ordering be asserted.
 */
export interface PrismaSsoDomainReproofDatabase {
  ssoConnection: {
    findMany(args: {
      where: {
        state: { in: string[] };
        NOT: { verifiedDomains: { isEmpty: true } };
        reproofCursor: { is: null } | { isNot: null };
      };
      select: { id: true; organizationId: true; verifiedDomains: true; domainVerifications: true };
      orderBy: { id: "asc" } | [{ reproofCursor: { lastReproofAt: "asc" } }, { id: "asc" }];
      take: number;
    }): Promise<ProvedConnectionRow[]>;
  };
  ssoConnectionReproofCursor: {
    createMany(args: {
      data: { connectionId: string; lastReproofAt: Date }[];
      skipDuplicates: true;
    }): Promise<unknown>;
    updateMany(args: {
      where: { connectionId: { in: string[] }; lastReproofAt: { lt: Date } };
      data: { lastReproofAt: Date };
    }): Promise<unknown>;
  };
}

/** Only a connection that routes has domains worth re-reading. */
const REPROOF_STATES = ["VERIFIED", "ACTIVE"];

const PROVED_CONNECTION = {
  state: { in: REPROOF_STATES },
  NOT: { verifiedDomains: { isEmpty: true } },
} as const;

const PROVED_COLUMNS = {
  id: true,
  organizationId: true,
  verifiedDomains: true,
  domainVerifications: true,
} as const;

/**
 * The rotation over `SsoConnection`, with the look kept in
 * `SsoConnectionReproofCursor`: operational scheduling state, deliberately
 * separate from the event-truth head so the projection keeps one writer.
 */
export class PrismaSsoDomainReproofTargetRepository implements SsoDomainReproofTargetRepository {
  static create(database: PrismaSsoDomainReproofDatabase): PrismaSsoDomainReproofTargetRepository {
    return new PrismaSsoDomainReproofTargetRepository(database);
  }

  constructor(private readonly prisma: PrismaSsoDomainReproofDatabase) {}

  /** Never looked at first, then the longest since — `id` breaks both ties. */
  async findDomainsProvedByRecord({ limit }: { limit: number }): Promise<SsoDomainReproofTarget[]> {
    const unswept = await this.prisma.ssoConnection.findMany({
      where: { ...PROVED_CONNECTION, reproofCursor: { is: null } },
      select: PROVED_COLUMNS,
      orderBy: { id: "asc" },
      take: limit,
    });
    const remaining = limit - unswept.length;
    const swept =
      remaining === 0
        ? []
        : await this.prisma.ssoConnection.findMany({
            where: { ...PROVED_CONNECTION, reproofCursor: { isNot: null } },
            select: PROVED_COLUMNS,
            orderBy: [{ reproofCursor: { lastReproofAt: "asc" } }, { id: "asc" }],
            take: remaining,
          });

    return [...unswept, ...swept].flatMap((row) =>
      reproofTargetsOf({
        connectionId: row.id,
        organizationId: row.organizationId,
        verifiedDomains: row.verifiedDomains,
        domainVerifications: row.domainVerifications,
      }),
    );
  }

  /**
   * Insert the cursors that are missing, then advance the ones that are
   * behind — two statements rather than an upsert loop, so a five-hundred
   * connection sweep stamps its look in two round trips.
   */
  async markSwept({
    connectionIds,
    atMs,
  }: {
    connectionIds: readonly string[];
    atMs: number;
  }): Promise<void> {
    if (connectionIds.length === 0) return;
    const lastReproofAt = new Date(atMs);
    const ids = [...new Set(connectionIds)];
    await this.prisma.ssoConnectionReproofCursor.createMany({
      data: ids.map((connectionId) => ({ connectionId, lastReproofAt })),
      skipDuplicates: true,
    });
    await this.prisma.ssoConnectionReproofCursor.updateMany({
      where: { connectionId: { in: ids }, lastReproofAt: { lt: lastReproofAt } },
      data: { lastReproofAt },
    });
  }
}
