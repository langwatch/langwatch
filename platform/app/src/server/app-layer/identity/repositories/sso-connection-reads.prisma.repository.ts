import {
  LIVE_IDENTIFIER_STATES,
  type SsoConnectionState,
} from "@langwatch/identity";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";

/**
 * The reads the connection guards run (D04, ADR-117 §5), over the
 * `SsoConnection` projection. Policy — what a state allows, who owns a domain
 * — lives in `@langwatch/identity-server`; this class returns stored facts.
 */
export class PrismaSsoConnectionReadRepository
  implements SsoConnectionReadRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findConnection({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoConnectionState | null> {
    const row = await this.prisma.ssoConnection.findUnique({
      where: { id: connectionId },
    });
    return row === null ? null : rowToConnection(row);
  }

  /**
   * First verifier owns, and this is where the scope of "owns" is decided.
   *
   * The query is deliberately unscoped by organization: on cloud that IS the
   * global rule, and on a self-hosted installation this table only ever holds
   * that installation's own connections, so the same statement means
   * "per-instance" there without a branch. Scoping it by deployment mode
   * would be a branch that is a no-op on one side and a hole on the other.
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
    return row === null
      ? null
      : { connectionId: row.id, organizationId: row.organizationId };
  }
}

/**
 * Who a teardown would strand (ADR-117 §5). Read over the identity heads —
 * D01's `Identifier` projection — because that is where "how can this person
 * get in" is answered, and teardown must not invent a second answer.
 *
 * A user is stranded when every live identifier they hold belongs to this
 * connection. Holding one elsewhere, of any live state, is a way in that
 * survives the teardown.
 */
export class PrismaSsoConnectionStrandingRepository
  implements SsoConnectionStrandingRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findStrandedUserIds({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<string[]> {
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
