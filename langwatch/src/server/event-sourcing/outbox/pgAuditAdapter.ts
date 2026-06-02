import type { PrismaClient } from "@prisma/client";
import { createLogger } from "~/utils/logger/server";
import type { QueueAuditAdapter } from "../queues/queue.types";
import { isCadence, isSettle, type OutboxJob } from "./payload";

const logger = createLogger("langwatch:outbox:pg-audit-adapter");

const SETTLE_NO_MATCH_REASON = "settle: no match";

/**
 * Projects every outbox queue lifecycle event into a `ReactorOutbox`
 * row (ADR-021 revision).
 *
 * One row per (trigger, trace) — both settle and cadence stages
 * target the same row via the shared `auditDedupKey` on the payload.
 * Lifecycle:
 *
 *   settle.onEnqueue   → INSERT status="queued", scheduledAt=settle end
 *   settle.onLeased    → status="dispatching"
 *   settle.onDispatched
 *     matched + cadence re-enqueued → cadence.onEnqueue already moved
 *       the row back to status="queued"; settle's terminal update is a
 *       no-op via the `WHERE status='dispatching'` filter
 *     no match → status="dispatched", lastError="settle: no match"
 *   settle.onFailed/onDead → conditional terminal (same WHERE filter)
 *   cadence.onEnqueue  → UPDATE existing row: status="queued",
 *                        scheduledAt=cadence boundary, attempts reset
 *   cadence.onLeased   → status="dispatching"
 *   cadence.onDispatched → status="dispatched"
 *   cadence.onFailed/onDead → standard retry/dead
 *
 * The CAS-style `WHERE status='dispatching'` on settle's terminal
 * hooks is what makes the lifecycle race-safe: by the time settle's
 * onDispatched fires, cadence's onEnqueue may have already updated
 * the row back to "queued"; the conditional update sees no matching
 * row and no-ops.
 *
 * Adapter writes are non-fatal — see `runAudit` in `GroupQueueProcessor`.
 */
export class PgOutboxAuditAdapter implements QueueAuditAdapter<OutboxJob> {
  constructor(private readonly prisma: PrismaClient) {}

  async onEnqueue(event: {
    payload: OutboxJob;
    groupKey: string;
    dedupKey: string | undefined;
    scheduledAt: Date;
    maxAttempts?: number;
  }): Promise<void> {
    const p = event.payload;
    if (isSettle(p)) {
      // Settle is the first stage — INSERT (idempotent via the
      // (reactorName, auditDedupKey) unique constraint). A replayed
      // settle for the same (trigger, trace) collapses.
      await this.write(() =>
        this.prisma.reactorOutbox.createMany({
          data: [
            {
              projectId: p.projectId,
              reactorName: p.reactorName,
              dedupKey: p.auditDedupKey,
              groupKey: event.groupKey,
              payload: p as object,
              status: "queued",
              attempts: 0,
              maxAttempts: event.maxAttempts ?? 8,
              nextAttemptAt: event.scheduledAt,
            },
          ],
          skipDuplicates: true,
        }),
      );
      return;
    }

    if (isCadence(p)) {
      // Cadence is the second stage — UPDATE the row settle wrote,
      // moving status back to "queued" with the new scheduled time.
      // attempts resets because cadence is a fresh dispatch attempt
      // independent of settle's filter check.
      const updated = await this.write(() =>
        this.prisma.reactorOutbox.updateMany({
          where: {
            projectId: p.projectId,
            reactorName: p.reactorName,
            dedupKey: p.auditDedupKey,
          },
          data: {
            status: "queued",
            attempts: 0,
            nextAttemptAt: event.scheduledAt,
            groupKey: event.groupKey,
            payload: p as object,
          },
        }),
      );
      // Defensive: if no settle row exists (e.g. caller wired cadence
      // directly without a settle stage), INSERT instead. Keeps the
      // adapter robust against partial-rollout misconfigurations.
      if (updated === 0) {
        await this.write(() =>
          this.prisma.reactorOutbox.createMany({
            data: [
              {
                projectId: p.projectId,
                reactorName: p.reactorName,
                dedupKey: p.auditDedupKey,
                groupKey: event.groupKey,
                payload: p as object,
                status: "queued",
                attempts: 0,
                maxAttempts: event.maxAttempts ?? 8,
                nextAttemptAt: event.scheduledAt,
              },
            ],
            skipDuplicates: true,
          }),
        );
      }
    }
  }

  async onLeased(event: { payload: OutboxJob }): Promise<void> {
    const p = event.payload;
    if (!isSettle(p) && !isCadence(p)) return;
    await this.write(() =>
      this.prisma.reactorOutbox.updateMany({
        where: {
          projectId: p.projectId,
          reactorName: p.reactorName,
          dedupKey: p.auditDedupKey,
        },
        data: { status: "dispatching", attempts: { increment: 1 } },
      }),
    );
  }

  async onDispatched(event: {
    payload: OutboxJob;
    at: Date;
  }): Promise<void> {
    const p = event.payload;
    if (isSettle(p)) {
      // Conditional CAS: only mark dispatched if the row is still in
      // "dispatching". If cadence already re-enqueued (settle matched
      // + claimed), status is back to "queued" and the WHERE doesn't
      // match — this becomes a no-op, which is correct.
      await this.write(() =>
        this.prisma.reactorOutbox.updateMany({
          where: {
            projectId: p.projectId,
            reactorName: p.reactorName,
            dedupKey: p.auditDedupKey,
            status: "dispatching",
          },
          data: {
            status: "dispatched",
            dispatchedAt: event.at,
            lastError: SETTLE_NO_MATCH_REASON,
          },
        }),
      );
      return;
    }
    if (isCadence(p)) {
      await this.write(() =>
        this.prisma.reactorOutbox.updateMany({
          where: {
            projectId: p.projectId,
            reactorName: p.reactorName,
            dedupKey: p.auditDedupKey,
          },
          data: {
            status: "dispatched",
            dispatchedAt: event.at,
            lastError: null,
          },
        }),
      );
    }
  }

  async onFailed(event: {
    payload: OutboxJob;
    error: string;
    willRetry: boolean;
    nextAttemptAt?: Date;
  }): Promise<void> {
    const p = event.payload;
    if (!isSettle(p) && !isCadence(p)) return;
    const baseWhere = {
      projectId: p.projectId,
      reactorName: p.reactorName,
      dedupKey: p.auditDedupKey,
    };
    // Settle's onFailed is conditional (only update if still leased).
    // Cadence's onFailed is unconditional (it owns the row at that point).
    const where = isSettle(p)
      ? { ...baseWhere, status: "dispatching" as const }
      : baseWhere;
    await this.write(() =>
      this.prisma.reactorOutbox.updateMany({
        where,
        data: {
          status: event.willRetry ? "failed_retryable" : "dead",
          lastError: event.error,
          lastErrorAt: new Date(),
          ...(event.willRetry && event.nextAttemptAt
            ? { nextAttemptAt: event.nextAttemptAt }
            : { nextAttemptAt: null }),
        },
      }),
    );
  }

  async onDead(event: {
    payload: OutboxJob;
    lastError: string;
  }): Promise<void> {
    const p = event.payload;
    if (!isSettle(p) && !isCadence(p)) return;
    const baseWhere = {
      projectId: p.projectId,
      reactorName: p.reactorName,
      dedupKey: p.auditDedupKey,
    };
    const where = isSettle(p)
      ? { ...baseWhere, status: "dispatching" as const }
      : baseWhere;
    await this.write(() =>
      this.prisma.reactorOutbox.updateMany({
        where,
        data: {
          status: "dead",
          lastError: event.lastError,
          lastErrorAt: new Date(),
          nextAttemptAt: null,
        },
      }),
    );
  }

  /**
   * Adapter writes are best-effort relative to the queue's own state.
   * A PG error logs+continues; the queue keeps running and the next
   * transition's write brings the projection back into sync. Returns
   * the rowsAffected count (for `onEnqueue`'s settle-fallback path) or
   * 0 on failure.
   */
  private async write(
    op: () => Promise<{ count: number } | unknown>,
  ): Promise<number> {
    try {
      const result = await op();
      if (
        result &&
        typeof result === "object" &&
        "count" in result &&
        typeof (result as { count: unknown }).count === "number"
      ) {
        return (result as { count: number }).count;
      }
      return 0;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "PgOutboxAuditAdapter write failed; queue keeps running, audit lags",
      );
      return 0;
    }
  }
}
