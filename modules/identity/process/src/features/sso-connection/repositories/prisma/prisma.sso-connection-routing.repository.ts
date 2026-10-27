import type { SsoConnectionState } from "@langwatch/identity-contract";
import type { SsoConnection } from "@langwatch/prisma-client/generated";

import { SsoConnectionRoutingRepository } from "../sso-connection-routing.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "./prisma.sso-connection-projection.repository.ts";

/** A connection nobody may be sent to any more, in either query. */
const GONE = ["DISCARDED", "TORN_DOWN"];

/** The two delegates this repository reads, and no other. */
export type PrismaSsoConnectionRoutingDatabase = {
  ssoConnection: {
    findFirst(args: {
      where: {
        source: string;
        state: { notIn: string[] };
        verifiedDomains: { has: string };
      };
    }): Promise<SsoConnection | null>;
    findMany(args: {
      where: {
        organizationId?: string;
        state?: { notIn: string[] };
        id?: { in: string[] };
        OR?: { id?: { in: string[] }; replacesConnectionId?: { in: string[] } }[];
      };
      orderBy?: { createdAt: "asc" };
    }): Promise<SsoConnection[]>;
  };
  ssoVerifiedDomain: {
    findUnique(args: {
      where: { domain: string };
      select: { holders: { select: { connectionId: true } } };
    }): Promise<{ holders: { connectionId: string }[] } | null>;
  };
};

/** The projection-backed domain lookup (D04, D09), over the ownership table and its connections. */
export class PrismaSsoConnectionRoutingRepository extends SsoConnectionRoutingRepository {
  static create({
    database,
  }: {
    database: PrismaSsoConnectionRoutingDatabase;
  }): PrismaSsoConnectionRoutingRepository {
    return new PrismaSsoConnectionRoutingRepository(database);
  }

  private constructor(private readonly database: PrismaSsoConnectionRoutingDatabase) {
    super();
  }

  async findDomainConnections({ domain }: { domain: string }): Promise<SsoConnectionState[]> {
    // Every state, not only ACTIVE: a SUSPENDED connection still OWNS its
    // domain, and filtering to ACTIVE here would make a paused connection
    // indistinguishable from a domain nobody ever configured.
    const ownership = await this.database.ssoVerifiedDomain.findUnique({
      where: { domain },
      select: { holders: { select: { connectionId: true } } },
    });
    if (ownership === null) return this.grandfathered({ domain });

    return this.pairedWith({ holderIds: ownership.holders.map((holder) => holder.connectionId) });
  }

  async findLiveConnections(): Promise<SsoConnectionState[]> {
    const rows = await this.database.ssoConnection.findMany({
      where: { state: { notIn: GONE } },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => this.connectionOf(row));
  }

  /** A connection whose domain predates the ownership table: the migration
   *  wrote the column, and sign-in has always been decided off it. */
  private async grandfathered({ domain }: { domain: string }): Promise<SsoConnectionState[]> {
    const legacy = await this.database.ssoConnection.findFirst({
      where: {
        source: "legacy-grandfathered",
        state: { notIn: GONE },
        verifiedDomains: { has: domain },
      },
    });

    return legacy === null ? [] : [this.connectionOf(legacy)];
  }

  /** Every connection of the holders' organization the holders are in a
   *  replacement pair with, so a cutover is decided on both halves at once. */
  private async pairedWith({ holderIds }: { holderIds: string[] }): Promise<SsoConnectionState[]> {
    const holders = await this.database.ssoConnection.findMany({
      where: { id: { in: holderIds } },
    });
    const organizationId = holders[0]?.organizationId;
    if (organizationId === undefined) return [];

    const rows = await this.database.ssoConnection.findMany({
      where: {
        organizationId,
        OR: [
          { id: { in: holderIds } },
          { replacesConnectionId: { in: holderIds } },
          {
            id: {
              in: holders.flatMap((holder) =>
                holder.replacesConnectionId === null ? [] : [holder.replacesConnectionId],
              ),
            },
          },
        ],
      },
    });

    return rows.map((row) => this.connectionOf(row));
  }

  private connectionOf(row: SsoConnection): SsoConnectionState {
    return PrismaSsoConnectionProjectionRepository.rowToConnection(row);
  }
}
