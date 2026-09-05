import { parseVirtualKeyConfig } from "@langwatch/gateway-contract";
import type {
  GatewayRealtimeSession,
  GatewayRealtimeSessionStatus,
  Prisma,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  GatewayRealtimeSessionRepository,
  type NewGatewayRealtimeSession,
  type ReserveResult,
} from "../gateway-realtime-session.repository";

/** The client slice realtime sessions are booked and settled through. */
export type GatewayRealtimeSessionDatabase = Pick<
  PrismaClient,
  "gatewayRealtimeSession" | "virtualKey" | "$transaction"
>;

/** Private Prisma owner for the record of brokered realtime voice sessions. */
export class PrismaGatewayRealtimeSessionRepository extends GatewayRealtimeSessionRepository {
  static create(input: {
    database: GatewayRealtimeSessionDatabase;
  }): PrismaGatewayRealtimeSessionRepository {
    return new PrismaGatewayRealtimeSessionRepository(input.database);
  }

  private constructor(private readonly database: GatewayRealtimeSessionDatabase) {
    super();
  }

  async reserve({
    session,
    staleBefore,
    closeReason,
  }: {
    session: NewGatewayRealtimeSession;
    staleBefore: Date;
    closeReason: string;
  }): Promise<ReserveResult> {
    return await this.database.$transaction(async (tx) => {
      // An advisory lock names no table and reads no row, so the raw-query
      // tenancy guard has nothing to check and is opted out of by name. The
      // lock key carries the tenancy itself: it is the project and the key
      // together, so two projects never contend and one key's mints serialize
      // against each other, which is what makes the count below a cap.
      const lockKey = `${session.projectId}:${session.virtualKeyId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})) -- @tenancy: a lock, not a read; the lock key is itself scoped to one project and key`;

      const key = await tx.virtualKey.findUnique({
        where: { id: session.virtualKeyId },
        select: { config: true },
      });
      const limit = parseVirtualKeyConfig(key?.config).realtime.maxOpenSessions;

      if (limit !== null) {
        // Expire this key's stale rows first, under the lock we already hold,
        // so the count and the table agree. A session no report ever closed
        // would otherwise sit OPEN forever and ratchet the key down one slot
        // at a time, which is the failure an OpenAI socket makes likely: it
        // never signals that it closed.
        await tx.gatewayRealtimeSession.updateMany({
          where: {
            virtualKeyId: session.virtualKeyId,
            status: "OPEN",
            mintedAt: { lt: staleBefore },
          },
          data: { status: "EXPIRED", closedAt: new Date(), closeReason },
        });
        const open = await tx.gatewayRealtimeSession.count({
          where: { virtualKeyId: session.virtualKeyId, status: "OPEN" },
        });
        if (open >= limit) {
          return { ok: false as const, reason: "session_limit" as const, open, limit };
        }
      }

      await tx.gatewayRealtimeSession.create({ data: { ...session, status: "OPEN" } });

      return { ok: true as const };
    });
  }

  async correlate({
    sessionId,
    projectId,
    vendorConversationId,
  }: {
    sessionId: string;
    projectId: string;
    vendorConversationId: string;
  }): Promise<boolean> {
    const updated = await this.database.gatewayRealtimeSession.updateMany({
      where: { id: sessionId, projectId },
      data: { vendorConversationId },
    });

    return updated.count > 0;
  }

  async release({
    sessionId,
    projectId,
    status,
    closeReason,
  }: {
    sessionId: string;
    projectId: string;
    status: GatewayRealtimeSessionStatus;
    closeReason: string;
  }): Promise<boolean> {
    const updated = await this.database.gatewayRealtimeSession.updateMany({
      where: { id: sessionId, projectId, status: "OPEN" },
      data: { status, closedAt: new Date(), closeReason },
    });

    return updated.count > 0;
  }

  tryFindByVendorConversationId({
    organizationId,
    vendor,
    vendorConversationId,
  }: {
    organizationId: string;
    vendor: string;
    vendorConversationId: string;
  }): Promise<GatewayRealtimeSession | null> {
    return this.database.gatewayRealtimeSession.findFirst({
      where: { organizationId, vendor, vendorConversationId },
    });
  }

  tryFindById({
    organizationId,
    vendor,
    id,
  }: {
    organizationId: string;
    vendor: string;
    id: string;
  }): Promise<GatewayRealtimeSession | null> {
    return this.database.gatewayRealtimeSession.findFirst({
      where: { organizationId, vendor, id },
    });
  }

  findOpenSince({
    organizationId,
    vendor,
    modelProviderId,
    since,
    limit,
  }: {
    organizationId: string;
    vendor: string;
    modelProviderId: string;
    since: Date;
    limit: number;
  }): Promise<GatewayRealtimeSession[]> {
    return this.database.gatewayRealtimeSession.findMany({
      where: {
        organizationId,
        vendor,
        modelProviderId,
        status: "OPEN",
        mintedAt: { gt: since },
      },
      take: limit,
    });
  }

  tryFindForReport({
    sessionId,
    projectId,
    virtualKeyId,
  }: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
  }): Promise<GatewayRealtimeSession | null> {
    return this.database.gatewayRealtimeSession.findFirst({
      where: { id: sessionId, projectId, virtualKeyId },
    });
  }

  async close({
    sessionId,
    projectId,
    closedAt,
    closeReason,
    vendorCostRaw,
  }: {
    sessionId: string;
    projectId: string;
    closedAt: Date;
    closeReason: string;
    vendorCostRaw?: unknown;
  }): Promise<number> {
    const { count } = await this.database.gatewayRealtimeSession.updateMany({
      where: { id: sessionId, projectId, status: { in: ["OPEN", "EXPIRED"] } },
      data: {
        status: "CLOSED",
        closedAt,
        closeReason,
        ...(vendorCostRaw === undefined
          ? {}
          : { vendorCostRaw: vendorCostRaw as Prisma.InputJsonValue }),
      },
    });

    return count;
  }

  async expireStale({
    virtualKeyId,
    now,
    staleBefore,
    closeReason,
  }: {
    virtualKeyId?: string;
    now: Date;
    staleBefore: Date;
    closeReason: string;
  }): Promise<number> {
    const { count } = await this.database.gatewayRealtimeSession.updateMany({
      where: {
        ...(virtualKeyId ? { virtualKeyId } : {}),
        status: "OPEN",
        mintedAt: { lt: staleBefore },
      },
      data: { status: "EXPIRED", closedAt: now, closeReason },
    });

    return count;
  }
}
