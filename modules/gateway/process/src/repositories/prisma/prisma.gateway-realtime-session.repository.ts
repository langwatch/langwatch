import { parseVirtualKeyConfig, spendUsageSchema } from "@langwatch/gateway-contract";
import type {
  GatewayRealtimeSession as GatewayRealtimeSessionRow,
  GatewayRealtimeSessionReport as GatewayRealtimeSessionReportRow,
} from "@langwatch/gateway-contract";
import {
  type GatewayRealtimeSession,
  type GatewayRealtimeSessionReport,
  type GatewayRealtimeSessionStatus,
  Prisma,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  GatewayRealtimeSessionRepository,
  type NewGatewayRealtimeSession,
  type NewGatewayRealtimeSessionReport,
  type ReserveResult,
} from "../gateway-realtime-session.repository.ts";

/** The client slice realtime sessions are booked and settled through. */
export type GatewayRealtimeSessionDatabase = Pick<
  PrismaClient,
  | "gatewayRealtimeSession"
  | "gatewayRealtimeSessionReport"
  | "virtualKey"
  | "$transaction"
  | "$executeRaw"
>;

/**
 * A write moving a session out of OPEN states its status condition against the
 * table: through `updateMany` it sits in a subquery, and a statement parked on
 * the row lock re-checks only the id, so it could regress a CLOSED row.
 */
type SessionStatusWriter = Pick<Prisma.TransactionClient, "$executeRaw">;

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
    staleBefore: Instant;
    closeReason: string;
  }): Promise<ReserveResult> {
    return this.database.$transaction(async (tx) => {
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
        await expireOpenSessions(tx, {
          virtualKeyId: session.virtualKeyId,
          closedAt: new Date(),
          staleBefore,
          closeReason,
        });
        const open = await tx.gatewayRealtimeSession.count({
          where: { virtualKeyId: session.virtualKeyId, status: "OPEN" },
        });
        if (open >= limit) {
          return { ok: false as const, reason: "session_limit" as const, open, limit };
        }
      }

      await tx.gatewayRealtimeSession.create({
        data: {
          ...session,
          credentialExpiresAt: session.credentialExpiresAt
            ? toDate(session.credentialExpiresAt)
            : null,
          status: "OPEN",
        },
      });

      return { ok: true as const };
    });
  }

  async correlate({
    sessionId,
    projectId,
    vendorConversationId,
    credentialExpiresAt,
  }: {
    sessionId: string;
    projectId: string;
    vendorConversationId?: string;
    credentialExpiresAt?: Instant;
  }): Promise<boolean> {
    const updated = await this.database.gatewayRealtimeSession.updateMany({
      where: { id: sessionId, projectId },
      data: {
        ...(vendorConversationId === undefined ? {} : { vendorConversationId }),
        ...(credentialExpiresAt === undefined
          ? {}
          : { credentialExpiresAt: toDate(credentialExpiresAt) }),
      },
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
    const updated = await this.database.$executeRaw`
      UPDATE "GatewayRealtimeSession"
         SET "status" = ${status}::"GatewayRealtimeSessionStatus",
             "closedAt" = now(),
             "closeReason" = ${closeReason},
             "updatedAt" = now()
       WHERE "id" = ${sessionId}
         AND "projectId" = ${projectId}
         AND "status" = 'OPEN'
    `;

    return updated > 0;
  }

  async findByVendorConversationId({
    organizationId,
    vendor,
    vendorConversationId,
  }: {
    organizationId: string;
    vendor: string;
    vendorConversationId: string;
  }): Promise<GatewayRealtimeSessionRow | null> {
    const row = await this.database.gatewayRealtimeSession.findFirst({
      where: { organizationId, vendor, vendorConversationId },
    });

    return row ? toRealtimeSessionRow(row) : null;
  }

  async findById({
    organizationId,
    vendor,
    id,
  }: {
    organizationId: string;
    vendor: string;
    id: string;
  }): Promise<GatewayRealtimeSessionRow | null> {
    const row = await this.database.gatewayRealtimeSession.findFirst({
      where: { organizationId, vendor, id },
    });

    return row ? toRealtimeSessionRow(row) : null;
  }

  async findOpenSince({
    organizationId,
    vendor,
    modelProviderId,
    since,
    limit,
  }: {
    organizationId: string;
    vendor: string;
    modelProviderId: string;
    since: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSessionRow[]> {
    const rows = await this.database.gatewayRealtimeSession.findMany({
      where: {
        organizationId,
        vendor,
        modelProviderId,
        status: "OPEN",
        mintedAt: { gt: toDate(since) },
      },
      take: limit,
    });

    return rows.map(toRealtimeSessionRow);
  }

  async findOpenAwaitingVendorReport({
    vendor,
    mintedBefore,
    limit,
  }: {
    vendor: string;
    mintedBefore: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSessionRow[]> {
    const rows = await this.database.gatewayRealtimeSession.findMany({
      where: {
        vendor,
        status: "OPEN",
        vendorConversationId: { not: null },
        mintedAt: { lt: toDate(mintedBefore) },
      },
      orderBy: { mintedAt: "asc" },
      take: limit,
    });

    return rows.map(toRealtimeSessionRow);
  }

  async findForReport({
    sessionId,
    projectId,
    virtualKeyId,
  }: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
  }): Promise<GatewayRealtimeSessionRow | null> {
    const row = await this.database.gatewayRealtimeSession.findFirst({
      where: { id: sessionId, projectId, virtualKeyId },
    });

    return row ? toRealtimeSessionRow(row) : null;
  }

  async close({
    sessionId,
    projectId,
    closedAt,
    closeReason,
    vendorCostRaw,
    settledCostNanoUsd,
  }: {
    sessionId: string;
    projectId: string;
    closedAt: Instant;
    closeReason: string;
    vendorCostRaw?: unknown;
    settledCostNanoUsd?: number;
  }): Promise<number> {
    // A report carrying no cost payload keeps the one the row already holds.
    const costPayload = vendorCostRaw === undefined ? null : JSON.stringify(vendorCostRaw);

    return this.database.$executeRaw`
      UPDATE "GatewayRealtimeSession"
         SET "status" = 'CLOSED',
             "closedAt" = ${toDate(closedAt)},
             "closeReason" = ${closeReason},
             "vendorCostRaw" = COALESCE(${costPayload}::jsonb, "vendorCostRaw"),
             "reportedCostNanoUsd" = "reportedCostNanoUsd" + ${BigInt(settledCostNanoUsd ?? 0)},
             "updatedAt" = now()
       WHERE "id" = ${sessionId}
         AND "projectId" = ${projectId}
         AND "status" IN ('OPEN', 'EXPIRED')
    `;
  }

  async findReport({
    sessionId,
    projectId,
    reportKey,
  }: {
    sessionId: string;
    projectId: string;
    reportKey: string;
  }): Promise<GatewayRealtimeSessionReportRow | null> {
    const row = await this.database.gatewayRealtimeSessionReport.findFirst({
      where: { sessionId, projectId, reportKey },
    });

    return row ? toRealtimeSessionReportRow(row) : null;
  }

  async recordReport({ report }: { report: NewGatewayRealtimeSessionReport }): Promise<boolean> {
    const recordedAt = toDate(report.recordedAt);

    return this.database.$transaction(async (tx) => {
      const inserted = await tx.gatewayRealtimeSessionReport.createMany({
        data: [
          {
            sessionId: report.sessionId,
            projectId: report.projectId,
            reportKey: report.reportKey,
            model: report.model,
            usage: report.usage,
            costNanoUsd: BigInt(report.costNanoUsd),
            createdAt: recordedAt,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return false;

      await tx.gatewayRealtimeSession.updateMany({
        where: { id: report.sessionId, projectId: report.projectId },
        data: {
          reportCount: { increment: 1 },
          reportedCostNanoUsd: { increment: BigInt(report.costNanoUsd) },
          lastReportAt: recordedAt,
        },
      });

      return true;
    });
  }

  async markHeardFrom({
    sessionId,
    projectId,
    at,
  }: {
    sessionId: string;
    projectId: string;
    at: Instant;
  }): Promise<void> {
    await this.database.gatewayRealtimeSession.updateMany({
      where: { id: sessionId, projectId },
      data: { lastReportAt: toDate(at) },
    });
  }

  async findReports({
    sessionId,
    projectId,
  }: {
    sessionId: string;
    projectId: string;
  }): Promise<GatewayRealtimeSessionReportRow[]> {
    const rows = await this.database.gatewayRealtimeSessionReport.findMany({
      where: { sessionId, projectId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toRealtimeSessionReportRow);
  }

  async sumReportCostSince({
    sessionId,
    projectId,
    since,
  }: {
    sessionId: string;
    projectId: string;
    since: Instant;
  }): Promise<number> {
    const total = await this.database.gatewayRealtimeSessionReport.aggregate({
      where: { sessionId, projectId, createdAt: { gte: toDate(since) } },
      _sum: { costNanoUsd: true },
    });

    return Number(total._sum.costNanoUsd ?? 0n);
  }

  async findOrphanedGatewaySessions({
    silentSince,
    limit,
  }: {
    silentSince: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSessionRow[]> {
    const before = { lt: toDate(silentSince) };
    const rows = await this.database.gatewayRealtimeSession.findMany({
      where: {
        status: "OPEN",
        metering: "gateway",
        OR: [{ lastReportAt: before }, { lastReportAt: null, mintedAt: before }],
      },
      orderBy: { mintedAt: "asc" },
      take: limit,
    });

    return rows.map(toRealtimeSessionRow);
  }

  async findAwaitingSettlement({
    kinds,
    mintedBefore,
    expiredReason,
    limit,
  }: {
    kinds: readonly string[];
    mintedBefore: Instant;
    expiredReason: string;
    limit: number;
  }): Promise<GatewayRealtimeSessionRow[]> {
    const rows = await this.database.gatewayRealtimeSession.findMany({
      where: {
        metering: "client",
        kind: { in: [...kinds] },
        mintedAt: { lt: toDate(mintedBefore) },
        OR: [{ status: "OPEN" }, { status: "EXPIRED", closeReason: expiredReason }],
      },
      orderBy: { mintedAt: "asc" },
      take: limit,
    });

    return rows.map(toRealtimeSessionRow);
  }

  async expireStale({
    virtualKeyId,
    now,
    staleBefore,
    closeReason,
  }: {
    virtualKeyId?: string;
    now: Instant;
    staleBefore: Instant;
    closeReason: string;
  }): Promise<number> {
    return expireOpenSessions(this.database, {
      virtualKeyId,
      closedAt: toDate(now),
      staleBefore,
      closeReason,
    });
  }
}

/** OPEN sessions minted before `staleBefore` become EXPIRED; one key's, or the fleet's. */
function expireOpenSessions(
  database: SessionStatusWriter,
  {
    virtualKeyId,
    closedAt,
    staleBefore,
    closeReason,
  }: { virtualKeyId?: string; closedAt: Date; staleBefore: Instant; closeReason: string },
): Promise<number> {
  const keyFilter = virtualKeyId ? Prisma.sql`AND "virtualKeyId" = ${virtualKeyId}` : Prisma.empty;

  return database.$executeRaw`
    -- @tenancy: a fleet sweep over open sessions; the mint path narrows it to one key under the cap's advisory lock
    UPDATE "GatewayRealtimeSession"
       SET "status" = 'EXPIRED',
           "closedAt" = ${closedAt},
           "closeReason" = ${closeReason},
           "updatedAt" = now()
     WHERE "status" = 'OPEN'
       AND "mintedAt" < ${toDate(staleBefore)}
       AND "metering" IS DISTINCT FROM 'gateway'
       ${keyFilter}
  `;
}

/** The one place a stored session's Dates become instants. */
function toRealtimeSessionRow(row: GatewayRealtimeSession): GatewayRealtimeSessionRow {
  return {
    ...row,
    mintedAt: fromDate(row.mintedAt),
    closedAt: row.closedAt ? fromDate(row.closedAt) : null,
    credentialExpiresAt: row.credentialExpiresAt ? fromDate(row.credentialExpiresAt) : null,
    lastReportAt: row.lastReportAt ? fromDate(row.lastReportAt) : null,
    reportedCostNanoUsd: Number(row.reportedCostNanoUsd),
    createdAt: fromDate(row.createdAt),
    updatedAt: fromDate(row.updatedAt),
  };
}

/** A stored report with its Json usage read back into the spend vocabulary. */
function toRealtimeSessionReportRow(
  row: GatewayRealtimeSessionReport,
): GatewayRealtimeSessionReportRow {
  return {
    sessionId: row.sessionId,
    reportKey: row.reportKey,
    projectId: row.projectId,
    model: row.model,
    usage: spendUsageSchema.parse(row.usage),
    costNanoUsd: Number(row.costNanoUsd),
    createdAt: fromDate(row.createdAt),
  };
}
