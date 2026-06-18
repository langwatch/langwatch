import type { PrismaClient } from "@prisma/client";
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
 * race cleanly without dead-locking. See ADR-026 for the lease
 * design and ADR-025 for the claim primitive.
 */
export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insertIfAbsent(row: OutboxInsertRow): Promise<boolean> {
    // `data` is an array (not a bare object): the multitenancy guard's
    // createMany branch maps over data to assert projectId on every row,
    // so it requires the array form.
    const result = await this.prisma.reactorOutbox.createMany({
      data: [
        {
          projectId: row.projectId,
          reactorName: row.reactorName,
          dedupKey: row.dedupKey,
          groupKey: row.groupKey,
          payload: row.payload,
          maxAttempts: row.maxAttempts,
        },
      ],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async leaseNext({
    projectId,
    reactorName,
    groupKey,
    leasedUntil,
    now,
  }: OutboxLeaseQuery): Promise<OutboxRow | null> {
    // `groupKey` is intentionally optional so the recovery / sweep paths
    // can still ignore it, but wakeup-driven leases ALWAYS pass it —
    // otherwise a wakeup for one group can drain another group's rows
    // for the same (projectId, reactorName), breaking the per-group
    // ordering this channel exists to preserve. Branches over a
    // template literal so the optional predicate doesn't fight Prisma's
    // tagged-template parameterisation.
    const rows =
      groupKey === undefined
        ? await this.prisma.$queryRaw<OutboxRow[]>`
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
        `
        : await this.prisma.$queryRaw<OutboxRow[]>`
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
              AND "groupKey" = ${groupKey}
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
      -- @tenancy: global crash-recovery sweep across all tenants
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
    projectId,
    now,
  }: {
    rowId: string;
    projectId: string;
    now: Date;
  }): Promise<void> {
    // CAS on `dispatching`: a row a recovery sweep already re-queued
    // (and a second worker re-leased) must not be marked dispatched by
    // this stale worker. projectId keeps the write tenant-scoped.
    await this.prisma.reactorOutbox.updateMany({
      where: { id: rowId, projectId, status: "dispatching" },
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
    projectId,
    attempts,
    status,
    nextAttemptAt,
    lastError,
    lastErrorAt,
  }: OutboxRetryUpdate): Promise<void> {
    // Conditional CAS: only transition while the row is still the one
    // this worker leased (`dispatching` + the same attempt count). If a
    // recovery sweep re-queued it and another worker re-leased
    // (bumping attempts), this no-ops instead of clobbering live state.
    // projectId scopes the write to the owning tenant.
    await this.prisma.reactorOutbox.updateMany({
      where: { id: rowId, projectId, status: "dispatching", attempts },
      data: {
        status,
        nextAttemptAt,
        leasedUntil: null,
        lastError,
        lastErrorAt,
        updatedAt: lastErrorAt,
      },
    });
  }

  async findById({
    rowId,
    projectId,
  }: {
    rowId: string;
    projectId: string;
  }): Promise<OutboxRow | null> {
    return this.prisma.reactorOutbox.findFirst({
      where: { id: rowId, projectId },
    });
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
