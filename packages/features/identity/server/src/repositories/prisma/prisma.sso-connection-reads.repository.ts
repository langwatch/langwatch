import { LIVE_IDENTIFIER_STATES, type SsoConnectionState } from "@langwatch/identity-contract";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
} from "../../sso-connection.repository";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaSsoConnectionProjectionRepository } from "./prisma.sso-connection-projection.repository";

/** The one model the connection guards read, and no other. */
export type PrismaSsoConnectionReadDatabase = Pick<PrismaClient, "ssoConnection">;

/** The identity heads a teardown's stranding check is answered from. */
export type PrismaSsoConnectionStrandingDatabase = Pick<PrismaClient, "identifier">;

/**
 * The reads the connection guards run (D04, ADR-117 §5), over the
 * `SsoConnection` projection. Policy — what a state allows, who owns a domain
 * — lives in `@langwatch/identity-server`; this class returns stored facts.
 */
export class PrismaSsoConnectionReadRepository implements SsoConnectionReadRepository {
  static create(database: PrismaSsoConnectionReadDatabase): PrismaSsoConnectionReadRepository {
    return new PrismaSsoConnectionReadRepository(database);
  }

  constructor(private readonly prisma: PrismaSsoConnectionReadDatabase) {}

  async findConnection({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoConnectionState | null> {
    const row = await this.prisma.ssoConnection.findUnique({
      where: { id: connectionId },
    });
    return row === null ? null : PrismaSsoConnectionProjectionRepository.rowToConnection(row);
  }

  /**
   * First verifier owns, and this is where the scope of "owns" is decided.
   */
  async findDomainOwner({
    domain,
  }: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null> {
    const row = await this.prisma.ssoConnection.findFirst({
      where: { state: "ACTIVE", verifiedDomains: { has: domain } },
      select: { id: true, organizationId: true },
    });
    return row === null ? null : { connectionId: row.id, organizationId: row.organizationId };
  }
}

/**
 * D01's `Identifier` projection — because that is where "how can this person get in" is answered,
 * and teardown must not invent a second answer.
 * Who a teardown would strand (ADR-117 §5). Read over the identity heads —
 */
export class PrismaSsoConnectionStrandingRepository implements SsoConnectionStrandingRepository {
  static create(
    database: PrismaSsoConnectionStrandingDatabase,
  ): PrismaSsoConnectionStrandingRepository {
    return new PrismaSsoConnectionStrandingRepository(database);
  }

  constructor(private readonly prisma: PrismaSsoConnectionStrandingDatabase) {}

  async findStrandedUserIds({ connectionId }: { connectionId: string }): Promise<string[]> {
    const held = await this.prisma.identifier.findMany({
      where: {
        connectionId,
        state: { in: [...LIVE_IDENTIFIER_STATES] },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    const userIds = held.map((row) => row.userId);
    if (userIds.length === 0) return [];

    const elsewhere = await this.prisma.identifier.findMany({
      where: {
        userId: { in: userIds },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        NOT: { connectionId },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    const covered = new Set(elsewhere.map((row) => row.userId));
    return userIds.filter((userId) => !covered.has(userId));
  }
}
