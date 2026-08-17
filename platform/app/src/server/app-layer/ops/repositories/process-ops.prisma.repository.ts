import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type { ProcessRef } from "~/server/event-sourcing/process-manager/processManager.types";
import type {
  DeadLetterCount,
  DeadOutboxMessageView,
  ProcessInstanceRow,
  ProcessNameCounts,
  ProcessOpsRepository,
  ProcessOutboxMessageView,
  ProcessWakeRow,
} from "./process-ops.repository";

/** `00-<32 hex trace id>-<16 hex span id>-<flags>` per W3C traceparent. */
const TRACEPARENT_RE = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

function traceIdFromCarrier(carrier: unknown): string | null {
  if (!carrier || typeof carrier !== "object") return null;
  const traceparent = (carrier as Record<string, unknown>).traceparent;
  if (typeof traceparent !== "string") return null;
  return TRACEPARENT_RE.exec(traceparent)?.[1] ?? null;
}

/** Escape LIKE wildcards so a search term matches literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Fleet-level reads over the process-manager substrate's own tables.
 *
 * The aggregate reads are deliberately cross-tenant — the same posture as the
 * substrate's own wake scanner — so they go through raw SQL with the guard's
 * explicit `-- @tenancy` opt-out; every returned row still carries its
 * project-scoped identity, and the surface they feed is ops-gated. The keyed
 * reads and every write stay on guarded Prisma queries that carry projectId.
 */
export class ProcessOpsPrismaRepository implements ProcessOpsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async countByProcessName(params: {
    now: number;
    overdueWakeMs: number;
    overduePendingMs: number;
  }): Promise<ProcessNameCounts[]> {
    const now = new Date(params.now);
    const overdueWakeBefore = new Date(params.now - params.overdueWakeMs);
    const overduePendingBefore = new Date(params.now - params.overduePendingMs);

    const [instances, outbox] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ processName: string; instances: number; overdueWakes: number }>
      >(Prisma.sql`
        -- @tenancy: cross-tenant ops fleet counts; the surface is ops-gated
        SELECT "processName",
               COUNT(*)::int AS "instances",
               COUNT(*) FILTER (WHERE "nextWakeAt" < ${overdueWakeBefore})::int AS "overdueWakes"
        FROM "ProcessManagerInstance"
        GROUP BY "processName"
      `),
      this.prisma.$queryRaw<
        Array<{
          processName: string;
          pendingMessages: number;
          overduePending: number;
          lapsedLeases: number;
          deadMessages: number;
        }>
      >(Prisma.sql`
        -- @tenancy: cross-tenant ops fleet counts; the surface is ops-gated
        SELECT "processName",
               COUNT(*) FILTER (WHERE "status" = 'pending')::int AS "pendingMessages",
               COUNT(*) FILTER (
                 WHERE "status" = 'pending'
                   AND "nextAttemptAt" < ${overduePendingBefore}
                   AND ("leasedUntil" IS NULL OR "leasedUntil" < ${now})
               )::int AS "overduePending",
               COUNT(*) FILTER (
                 WHERE "status" = 'pending' AND "leasedUntil" < ${now}
               )::int AS "lapsedLeases",
               COUNT(*) FILTER (WHERE "status" = 'dead')::int AS "deadMessages"
        FROM "ProcessManagerOutbox"
        WHERE "status" IN ('pending', 'dead')
        GROUP BY "processName"
      `),
    ]);

    const byName = new Map<string, ProcessNameCounts>();
    const row = (name: string) => {
      const existing = byName.get(name);
      if (existing) return existing;
      const fresh: ProcessNameCounts = {
        processName: name,
        instances: 0,
        overdueWakes: 0,
        pendingMessages: 0,
        overduePending: 0,
        lapsedLeases: 0,
        deadMessages: 0,
      };
      byName.set(name, fresh);
      return fresh;
    };

    for (const r of instances) {
      Object.assign(row(r.processName), {
        instances: r.instances,
        overdueWakes: r.overdueWakes,
      });
    }
    for (const r of outbox) {
      Object.assign(row(r.processName), {
        pendingMessages: r.pendingMessages,
        overduePending: r.overduePending,
        lapsedLeases: r.lapsedLeases,
        deadMessages: r.deadMessages,
      });
    }
    return Array.from(byName.values());
  }

  async findInstances(params: {
    /** Omit to list instances across EVERY process manager. */
    processName?: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }> {
    const search = params.search?.trim();
    const searchFilter = search
      ? Prisma.sql`AND "processKey" ILIKE ${`%${escapeLike(search)}%`}`
      : Prisma.empty;
    const nameFilter = params.processName
      ? Prisma.sql`AND "processName" = ${params.processName}`
      : Prisma.empty;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          processName: string;
          projectId: string;
          processKey: string;
          tenantId: string;
          revision: number;
          nextWakeAt: Date | null;
          updatedAt: Date;
        }>
      >(Prisma.sql`
        -- @tenancy: cross-tenant ops listing; rows carry their project identity
        SELECT "processName", "projectId", "processKey", "tenantId",
               "revision", "nextWakeAt", "updatedAt"
        FROM "ProcessManagerInstance"
        WHERE 1 = 1
        ${nameFilter}
        ${searchFilter}
        ORDER BY "updatedAt" DESC
        LIMIT ${params.pageSize}
        OFFSET ${(params.page - 1) * params.pageSize}
      `),
      this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        -- @tenancy: cross-tenant ops listing; rows carry their project identity
        SELECT COUNT(*)::int AS "total"
        FROM "ProcessManagerInstance"
        WHERE 1 = 1
        ${nameFilter}
        ${searchFilter}
      `),
    ]);

    // Per-row outbox trouble for just this page's instances. The tuple filter
    // carries processName so an all-process page can never mix up two
    // processes sharing a (projectId, processKey) pair.
    const counts = new Map<string, { pending: number; dead: number }>();
    if (rows.length > 0) {
      const pairs = Prisma.join(
        rows.map(
          (r) =>
            Prisma.sql`(${r.processName}, ${r.projectId}, ${r.processKey})`,
        ),
      );
      const outbox = await this.prisma.$queryRaw<
        Array<{
          processName: string;
          projectId: string;
          processKey: string;
          pending: number;
          dead: number;
        }>
      >(Prisma.sql`
        -- @tenancy: scoped to the page's (processName, projectId, processKey) tuples above
        SELECT "processName", "projectId", "processKey",
               COUNT(*) FILTER (WHERE "status" = 'pending')::int AS "pending",
               COUNT(*) FILTER (WHERE "status" = 'dead')::int AS "dead"
        FROM "ProcessManagerOutbox"
        WHERE "status" IN ('pending', 'dead')
          AND ("processName", "projectId", "processKey") IN (${pairs})
        GROUP BY "processName", "projectId", "processKey"
      `);
      for (const o of outbox) {
        counts.set(`${o.processName} ${o.projectId} ${o.processKey}`, {
          pending: o.pending,
          dead: o.dead,
        });
      }
    }

    return {
      total: totals[0]?.total ?? 0,
      instances: rows.map((r) => {
        const c = counts.get(`${r.processName} ${r.projectId} ${r.processKey}`);
        return {
          processName: r.processName,
          projectId: r.projectId,
          processKey: r.processKey,
          tenantId: r.tenantId,
          revision: r.revision,
          nextWakeAt: r.nextWakeAt?.getTime() ?? null,
          updatedAt: r.updatedAt.getTime(),
          pendingMessages: c?.pending ?? 0,
          deadMessages: c?.dead ?? 0,
        };
      }),
    };
  }

  async findUpcomingWakes(params: {
    limit: number;
  }): Promise<ProcessWakeRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        processName: string;
        projectId: string;
        processKey: string;
        nextWakeAt: Date;
      }>
    >(Prisma.sql`
      -- @tenancy: cross-tenant ops listing; rows carry their project identity
      SELECT "processName", "projectId", "processKey", "nextWakeAt"
      FROM "ProcessManagerInstance"
      WHERE "nextWakeAt" IS NOT NULL
      ORDER BY "nextWakeAt" ASC
      LIMIT ${Math.min(Math.max(params.limit, 1), 200)}
    `);
    return rows.map((r) => ({
      processName: r.processName,
      projectId: r.projectId,
      processKey: r.processKey,
      nextWakeAt: r.nextWakeAt.getTime(),
    }));
  }

  async findOutboxMessages(params: {
    ref: ProcessRef;
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }> {
    const where = {
      processName: params.ref.processName,
      projectId: params.ref.projectId,
      processKey: params.ref.processKey,
    };
    const [rows, total] = await Promise.all([
      this.prisma.processManagerOutbox.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.processManagerOutbox.count({ where }),
    ]);
    return {
      total,
      messages: rows.map((r) => ({
        id: r.id,
        messageKey: r.messageKey,
        intentType: r.intentType,
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt: r.nextAttemptAt.getTime(),
        leasedUntil: r.leasedUntil?.getTime() ?? null,
        createdAt: r.createdAt.getTime(),
        sourceEventId: r.sourceEventId,
        traceId: traceIdFromCarrier(r.traceCarrier),
        payload: r.payload,
      })),
    };
  }

  /**
   * Every retired message across the fleet, newest retirement first.
   *
   * Ordered by `updatedAt` rather than `createdAt`: a dead row's interesting
   * moment is when it was RETIRED, and a message that spent 68 hours climbing
   * the Stripe ladder before dying is days newer than its creation suggests.
   * An operator opening this mid-incident wants what just broke at the top.
   */
  async findDeadMessages(params: {
    processName?: string;
    page: number;
    pageSize: number;
  }): Promise<{ messages: DeadOutboxMessageView[]; total: number }> {
    // Raw, like every other fleet-wide read here: the multitenancy guard
    // rejects a Prisma query on this model without a `projectId`, and a
    // dead-letter sweep has no single project to name. The `@tenancy` marker
    // is the same declaration `countByProcessName` makes, and the surface is
    // ops-gated.
    const nameFilter = params.processName
      ? Prisma.sql`AND "processName" = ${params.processName}`
      : Prisma.empty;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<
        Array<
          Omit<
            DeadOutboxMessageView,
            "nextAttemptAt" | "leasedUntil" | "createdAt" | "updatedAt"
          > & {
            nextAttemptAt: Date;
            leasedUntil: Date | null;
            createdAt: Date;
            updatedAt: Date;
            traceCarrier: unknown;
          }
        >
      >(Prisma.sql`
        -- @tenancy: cross-tenant ops dead-letter read; the surface is ops-gated
        SELECT "id", "processName", "projectId", "processKey", "messageKey",
               "intentType", "status", "attempts", "nextAttemptAt",
               "leasedUntil", "createdAt", "updatedAt", "sourceEventId",
               "traceCarrier", "payload"
        FROM "ProcessManagerOutbox"
        WHERE "status" = 'dead'
        ${nameFilter}
        ORDER BY "updatedAt" DESC, "id" DESC
        LIMIT ${params.pageSize}
        OFFSET ${(params.page - 1) * params.pageSize}
      `),
      this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        -- @tenancy: cross-tenant ops dead-letter read; the surface is ops-gated
        SELECT COUNT(*)::int AS "total"
        FROM "ProcessManagerOutbox"
        WHERE "status" = 'dead'
        ${nameFilter}
      `),
    ]);

    return {
      total: totals[0]?.total ?? 0,
      messages: rows.map((r) => ({
        id: r.id,
        processName: r.processName,
        projectId: r.projectId,
        processKey: r.processKey,
        messageKey: r.messageKey,
        intentType: r.intentType,
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt: r.nextAttemptAt.getTime(),
        leasedUntil: r.leasedUntil?.getTime() ?? null,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
        sourceEventId: r.sourceEventId,
        traceId: traceIdFromCarrier(r.traceCarrier),
        payload: r.payload,
      })),
    };
  }

  /**
   * Indexing, deliberately left to ops.
   *
   * The reads below scan `status = 'dead'` and sort by `updatedAt`. The
   * table's only relevant index leads with `status`, which narrows to the
   * dead rows; the sort over that subset is what is unindexed. That is
   * acceptable because the dead population is bounded by operator attention
   * rather than by traffic — a fleet with enough dead messages for this sort
   * to matter has a far louder problem than the query plan.
   *
   * A Prisma migration is the wrong instrument if it ever does matter: a
   * deploy-time CREATE INDEX takes a SHARE lock on the highest-volume write
   * path in the system. The schema says as much for the two indexes the
   * retention sweep wanted, and the answer there is the same one here —
   * CREATE INDEX CONCURRENTLY, run from the runbook.
   */
  async countDeadByProcessName(): Promise<DeadLetterCount[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ processName: string; count: number; oldestUpdatedAt: Date }>
    >(Prisma.sql`
      -- @tenancy: cross-tenant ops dead-letter totals; the surface is ops-gated
      SELECT "processName",
             COUNT(*)::int AS "count",
             MIN("updatedAt") AS "oldestUpdatedAt"
      FROM "ProcessManagerOutbox"
      WHERE "status" = 'dead'
      GROUP BY "processName"
      ORDER BY COUNT(*) DESC
    `);
    return rows.map((r) => ({
      processName: r.processName,
      count: r.count,
      oldestUpdatedAt: r.oldestUpdatedAt?.getTime() ?? 0,
    }));
  }

  async wakeInstanceNow(params: {
    ref: ProcessRef;
    now: number;
  }): Promise<{ woke: boolean; previousWakeAt: number | null }> {
    // The redundant top-level projectId beside the compound unique is how the
    // substrate's own store satisfies the tenancy guard; same spelling here.
    const where = {
      projectId: params.ref.projectId,
      processName_projectId_processKey: params.ref,
    };
    const existing = await this.prisma.processManagerInstance.findUnique({
      where,
      select: { nextWakeAt: true },
    });
    if (!existing) return { woke: false, previousWakeAt: null };
    await this.prisma.processManagerInstance.update({
      where,
      data: { nextWakeAt: new Date(params.now) },
    });
    return {
      woke: true,
      previousWakeAt: existing.nextWakeAt?.getTime() ?? null,
    };
  }

  async redriveDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null> {
    const message = await this.prisma.processManagerOutbox.findFirst({
      where: {
        id: params.messageId,
        projectId: params.ref.projectId,
        processName: params.ref.processName,
        processKey: params.ref.processKey,
        status: "dead",
      },
      select: { messageKey: true },
    });
    if (!message) return null;
    // Guarded on status in the WHERE too: a dispatch racing this click must
    // not have its bookkeeping clobbered by the reset.
    const updated = await this.prisma.processManagerOutbox.updateMany({
      where: {
        id: params.messageId,
        projectId: params.ref.projectId,
        status: "dead",
      },
      data: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(params.now),
        leasedUntil: null,
        leaseToken: null,
        updatedAt: new Date(params.now),
      },
    });
    if (updated.count === 0) return null;
    return { messageKey: message.messageKey };
  }

  async releaseLapsedLease(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null> {
    const now = new Date(params.now);
    const message = await this.prisma.processManagerOutbox.findFirst({
      where: {
        id: params.messageId,
        projectId: params.ref.projectId,
        processName: params.ref.processName,
        processKey: params.ref.processKey,
      },
      select: { messageKey: true },
    });
    if (!message) return null;
    // The lapsed check lives in the WHERE, not just in the read above: a
    // delivery that renews or completes between the read and this write must
    // win the race.
    const updated = await this.prisma.processManagerOutbox.updateMany({
      where: {
        id: params.messageId,
        projectId: params.ref.projectId,
        status: "pending",
        leasedUntil: { lt: now },
      },
      data: {
        leasedUntil: null,
        leaseToken: null,
        nextAttemptAt: now,
        updatedAt: now,
      },
    });
    if (updated.count === 0) return null;
    return { messageKey: message.messageKey };
  }
}
