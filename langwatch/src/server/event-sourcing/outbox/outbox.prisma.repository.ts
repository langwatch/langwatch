import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  OutboxInsertRow,
  OutboxLeaseQuery,
  OutboxListQuery,
  OutboxRepository,
  OutboxRetryUpdate,
} from "./outbox.repository";
import type { OutboxRow } from "./outbox.types";

/**
 * Prisma-backed ReactorOutbox repository.
 *
 * `leaseNext` and `recoverExpiredLeases` use raw SQL with
 * `FOR UPDATE SKIP LOCKED` so concurrent drainers across processes
 * race cleanly without dead-locking. See ADR-023 for the lease
 * design and ADR-022 for the claim primitive.
 */
export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insertIfAbsent(row: OutboxInsertRow): Promise<boolean> {
    const result = await this.prisma.reactorOutbox.createMany({
      data: {
        projectId: row.projectId,
        reactorName: row.reactorName,
        dedupKey: row.dedupKey,
        groupKey: row.groupKey,
        payload: row.payload as Prisma.InputJsonValue,
        maxAttempts: row.maxAttempts,
      },
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async leaseNext({
    projectId,
    reactorName,
    leasedUntil,
    now,
  }: OutboxLeaseQuery): Promise<OutboxRow | null> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE "ReactorOutbox"
      SET
        "status" = 'dispatching',
        "leasedUntil" = ${leasedUntil},
        "attempts" = "attempts" + 1,
        "updatedAt" = ${now}
      WHERE "id" = (
        SELECT "id"
        FROM "ReactorOutbox"
        WHERE "projectId" = ${projectId}
          AND "reactorName" = ${reactorName}
          AND "status" IN ('queued', 'failed_retryable')
          AND "nextAttemptAt" <= ${now}
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;
    return rows[0] ?? null;
  }

  async recoverExpiredLeases({
    now,
    limit,
  }: {
    now: Date;
    limit: number;
  }): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "ReactorOutbox"
      SET
        "status" = 'queued',
        "leasedUntil" = NULL,
        "updatedAt" = ${now}
      WHERE "id" IN (
        SELECT "id"
        FROM "ReactorOutbox"
        WHERE "status" = 'dispatching'
          AND "leasedUntil" IS NOT NULL
          AND "leasedUntil" < ${now}
        ORDER BY "leasedUntil" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"
    `;
    return rows.length;
  }

  async markDispatched({
    rowId,
    now,
  }: {
    rowId: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.reactorOutbox.update({
      where: { id: rowId },
      data: {
        status: "dispatched",
        leasedUntil: null,
        dispatchedAt: now,
        updatedAt: now,
      },
    });
  }

  async markRetry({
    rowId,
    attempts,
    status,
    nextAttemptAt,
    lastError,
    lastErrorAt,
  }: OutboxRetryUpdate): Promise<void> {
    await this.prisma.reactorOutbox.update({
      where: { id: rowId },
      data: {
        status,
        attempts,
        nextAttemptAt: nextAttemptAt ?? undefined,
        leasedUntil: null,
        lastError,
        lastErrorAt,
        updatedAt: lastErrorAt,
      },
    });
  }

  async findById(rowId: string): Promise<OutboxRow | null> {
    return this.prisma.reactorOutbox.findUnique({ where: { id: rowId } });
  }

  async list({
    projectId,
    reactorName,
    status,
    limit,
  }: OutboxListQuery): Promise<OutboxRow[]> {
    return this.prisma.reactorOutbox.findMany({
      where: {
        projectId,
        ...(reactorName ? { reactorName } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }
}
