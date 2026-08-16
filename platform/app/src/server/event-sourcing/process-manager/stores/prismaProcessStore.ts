import { generate } from "@langwatch/ksuid";
import {
  Prisma,
  type PrismaClient,
  type ProcessManagerInstance,
  type ProcessManagerOutbox,
} from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { JsonValue } from "../json";
import type { ProcessRef } from "../processManager.types";
import { deriveInboxKey } from "./inboxKey";
import type {
  CommitResult,
  DueWake,
  LeasedOutboxMessageRecord,
  OutboxMessageIdentity,
  OutboxMessageRecord,
  PersistedProcessInstance,
  ProcessCommit,
  ProcessStore,
} from "./processStore.types";

class DuplicateInboxRollback extends Error {}

function refWhere(ref: ProcessRef) {
  return {
    processName: ref.processName,
    projectId: ref.projectId,
    processKey: ref.processKey,
  };
}

function refLockKey(ref: ProcessRef): string {
  return JSON.stringify([ref.processName, ref.projectId, ref.processKey]);
}

function asDate(epochMs: number): Date {
  return new Date(epochMs);
}

function toJsonInput(
  value: JsonValue,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value;
}

function toTraceCarrier(value: Prisma.JsonValue): Record<string, string> {
  // The service creates this value as Record<string, string> and the adapter
  // writes it unchanged. Domain validation deliberately remains outside the
  // persistence layer.
  return value as Record<string, string>;
}

function toMessage(row: ProcessManagerOutbox): OutboxMessageRecord {
  return {
    processName: row.processName,
    projectId: row.projectId,
    processKey: row.processKey,
    tenantId: row.tenantId,
    ...(row.userId === null ? {} : { userId: row.userId }),
    messageKey: row.messageKey,
    intentType: row.intentType,
    payload: row.payload as JsonValue,
    traceCarrier: toTraceCarrier(row.traceCarrier),
    sourceEventId: row.sourceEventId,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.getTime(),
    leaseToken: row.leaseToken,
    createdAt: row.createdAt.getTime(),
  };
}

function toLeasedMessage(row: ProcessManagerOutbox): LeasedOutboxMessageRecord {
  const message = toMessage(row);
  if (message.leaseToken === null) {
    throw new Error(`Leased outbox message ${row.id} has no lease token`);
  }
  return { ...message, leaseToken: message.leaseToken };
}

/**
 * Timeouts for the commit transaction. The two knobs cover different windows,
 * and only one of them covers the lock.
 *
 * `timeout` bounds the callback body, which is where the waiting happens: the
 * first thing the body does is take a BLOCKING `pg_advisory_xact_lock` on the
 * process reference, so this budget has to cover however long a concurrent
 * commit for the same process holds that lock, not just this commit's own
 * work. A suite finishing several runs at once produces exactly that
 * contention, and Prisma's 5s default was not enough for it — observed in
 * local dev as "timeout was 5000 ms, however 7737 ms passed".
 *
 * `maxWait` bounds the window *before* the callback runs: acquiring a
 * connection from the pool. It moves up too because the same contention keeps
 * connections busy, and a commit that never gets a connection fails without
 * ever reaching its `timeout`.
 *
 * The work inside is unchanged and still small: a lock, a dedup read, a
 * compare-and-swap on the instance, and the inbox/outbox inserts.
 */
const COMMIT_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 20_000,
} as const;

/** Durable Postgres implementation of the process state/inbox/outbox port. */
export class PrismaProcessStore implements ProcessStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findByRef<State = unknown>(params: {
    ref: ProcessRef;
  }): Promise<PersistedProcessInstance<State> | null> {
    const row = await this.prisma.processManagerInstance.findUnique({
      where: {
        projectId: params.ref.projectId,
        processName_projectId_processKey: refWhere(params.ref),
      },
    });
    if (!row) return null;
    return {
      ref: params.ref,
      tenantId: row.tenantId,
      ...(row.userId === null ? {} : { userId: row.userId }),
      state: row.state as State,
      revision: row.revision,
      nextWakeAt: row.nextWakeAt?.getTime() ?? null,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async commit<State = unknown>(
    commit: ProcessCommit<State>,
  ): Promise<CommitResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // This lock only serializes commits for the same process reference.
        // Revision remains an explicit compare-and-swap below; the lock also
        // closes the absent-row race for the first commit.
        await tx.$queryRaw`
          -- @tenancy: advisory-lock helper, key is process-ref-bounded
          WITH process_lock AS MATERIALIZED (
            SELECT pg_advisory_xact_lock(
              hashtextextended(${refLockKey(commit.ref)}, 0)
            )
          )
          SELECT 1 AS "acquired" FROM process_lock
        `;

        if (commit.sourceEventId !== null) {
          const duplicate = await tx.processManagerInbox.findUnique({
            where: {
              projectId: commit.ref.projectId,
              processName_projectId_sourceEventKey: {
                processName: commit.ref.processName,
                projectId: commit.ref.projectId,
                sourceEventKey: deriveInboxKey(commit.sourceEventId),
              },
            },
            select: { id: true },
          });
          if (duplicate) return { outcome: "duplicateEvent" as const };
        }

        const existing = await tx.processManagerInstance.findUnique({
          where: {
            projectId: commit.ref.projectId,
            processName_projectId_processKey: refWhere(commit.ref),
          },
          select: { revision: true },
        });
        const actualRevision = existing?.revision ?? 0;
        if (actualRevision !== commit.expectedRevision) {
          return {
            outcome: "revisionConflict" as const,
            actualRevision,
          };
        }

        const revision = actualRevision + 1;
        const instanceData = {
          tenantId: commit.tenantId,
          userId: commit.userId ?? null,
          state: toJsonInput(commit.state as JsonValue),
          revision,
          nextWakeAt:
            commit.nextWakeAt === null ? null : asDate(commit.nextWakeAt),
          updatedAt: asDate(commit.now),
        };

        if (actualRevision === 0) {
          const inserted = await tx.processManagerInstance.createMany({
            data: [
              {
                id: generate(
                  KSUID_RESOURCES.PROCESS_MANAGER_INSTANCE,
                ).toString(),
                ...refWhere(commit.ref),
                ...instanceData,
              },
            ],
            skipDuplicates: true,
          });
          if (inserted.count !== 1) {
            const current = await tx.processManagerInstance.findUnique({
              where: {
                projectId: commit.ref.projectId,
                processName_projectId_processKey: refWhere(commit.ref),
              },
              select: { revision: true },
            });
            return {
              outcome: "revisionConflict" as const,
              actualRevision: current?.revision ?? 0,
            };
          }
        } else {
          const updated = await tx.processManagerInstance.updateMany({
            where: {
              ...refWhere(commit.ref),
              revision: commit.expectedRevision,
            },
            data: instanceData,
          });
          if (updated.count !== 1) {
            const current = await tx.processManagerInstance.findUnique({
              where: {
                projectId: commit.ref.projectId,
                processName_projectId_processKey: refWhere(commit.ref),
              },
              select: { revision: true },
            });
            return {
              outcome: "revisionConflict" as const,
              actualRevision: current?.revision ?? 0,
            };
          }
        }

        if (commit.sourceEventId !== null) {
          const inbox = await tx.processManagerInbox.createMany({
            data: [
              {
                id: generate(KSUID_RESOURCES.PROCESS_MANAGER_INBOX).toString(),
                ...refWhere(commit.ref),
                tenantId: commit.tenantId,
                sourceEventId: commit.sourceEventId,
                sourceEventKey: deriveInboxKey(commit.sourceEventId),
                consumedAt: asDate(commit.now),
              },
            ],
            skipDuplicates: true,
          });
          // The source-event uniqueness spans process keys. If another ref
          // won that race, roll back the state CAS before reporting duplicate.
          if (inbox.count !== 1) throw new DuplicateInboxRollback();
        }

        const insertedMessageKeys: string[] = [];
        const duplicateMessageKeys: string[] = [];
        for (const message of commit.messages) {
          const inserted = await tx.processManagerOutbox.createMany({
            data: [
              {
                id: generate(KSUID_RESOURCES.PROCESS_MANAGER_OUTBOX).toString(),
                ...refWhere(commit.ref),
                tenantId: commit.tenantId,
                userId: message.userId ?? null,
                messageKey: message.messageKey,
                intentType: message.intentType,
                payload: toJsonInput(message.payload),
                traceCarrier: message.traceCarrier,
                sourceEventId: commit.sourceEventId,
                status: "pending",
                attempts: 0,
                nextAttemptAt: asDate(commit.now),
                leasedUntil: null,
                leaseToken: null,
                dispatchedAt: null,
                createdAt: asDate(commit.now),
                updatedAt: asDate(commit.now),
              },
            ],
            skipDuplicates: true,
          });
          (inserted.count === 1
            ? insertedMessageKeys
            : duplicateMessageKeys
          ).push(message.messageKey);
        }

        return {
          outcome: "committed" as const,
          revision,
          insertedMessageKeys,
          duplicateMessageKeys,
        };
      }, COMMIT_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof DuplicateInboxRollback) {
        return { outcome: "duplicateEvent" };
      }
      throw error;
    }
  }

  async findMessagesByRef(params: {
    ref: ProcessRef;
  }): Promise<OutboxMessageRecord[]> {
    const rows = await this.prisma.processManagerOutbox.findMany({
      where: refWhere(params.ref),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toMessage);
  }

  async leaseDueMessages(params: {
    now: number;
    limit: number;
    leaseDurationMs: number;
    processNames?: readonly string[];
  }): Promise<LeasedOutboxMessageRecord[]> {
    if (params.limit <= 0) return [];
    if (params.processNames && params.processNames.length === 0) return [];
    const now = asDate(params.now);
    const leasedUntil = asDate(params.now + params.leaseDurationMs);
    const leaseBatchToken = generate(
      KSUID_RESOURCES.PROCESS_MANAGER_OUTBOX,
    ).toString();
    const processNameFilter = params.processNames
      ? Prisma.sql`AND "processName" IN (${Prisma.join([...params.processNames])})`
      : Prisma.empty;
    const rows = await this.prisma.$transaction(async (tx) => {
      return await tx.$queryRaw<ProcessManagerOutbox[]>(Prisma.sql`
        -- @tenancy: outbox claim is cross-project worker infrastructure by design
        WITH candidates AS (
          SELECT "id"
          FROM "ProcessManagerOutbox"
          WHERE "status" = 'pending'::"ProcessManagerOutboxStatus"
            AND "nextAttemptAt" <= ${now}
            AND ("leasedUntil" IS NULL OR "leasedUntil" <= ${now})
            ${processNameFilter}
          ORDER BY "nextAttemptAt" ASC, "createdAt" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${params.limit}
        )
        UPDATE "ProcessManagerOutbox" AS outbox
        SET "leasedUntil" = ${leasedUntil},
            "leaseToken" = CAST(${leaseBatchToken} AS TEXT) || ':' || outbox."id",
            "attempts" = outbox."attempts" + 1,
            "updatedAt" = ${now}
        FROM candidates
        WHERE outbox."id" = candidates."id"
        RETURNING outbox.*
      `);
    });
    return rows.map(toLeasedMessage);
  }

  async markDispatched(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<{ applied: boolean }> {
    const result = await this.prisma.processManagerOutbox.updateMany({
      where: {
        ...params.identity,
        leaseToken: params.leaseToken,
        status: "pending",
      },
      data: {
        status: "dispatched",
        leasedUntil: null,
        leaseToken: null,
        dispatchedAt: asDate(params.now),
        updatedAt: asDate(params.now),
      },
    });
    return { applied: result.count === 1 };
  }

  async markFailed(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
    nextAttemptAt: number;
    dead: boolean;
  }): Promise<{ applied: boolean }> {
    const result = await this.prisma.processManagerOutbox.updateMany({
      where: {
        ...params.identity,
        leaseToken: params.leaseToken,
        status: "pending",
      },
      data: {
        status: params.dead ? "dead" : "pending",
        nextAttemptAt: asDate(params.nextAttemptAt),
        leasedUntil: null,
        leaseToken: null,
        updatedAt: asDate(params.now),
      },
    });
    return { applied: result.count === 1 };
  }

  async releaseLease(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<{ applied: boolean }> {
    const result = await this.prisma.processManagerOutbox.updateMany({
      where: {
        ...params.identity,
        leaseToken: params.leaseToken,
        status: "pending",
      },
      data: {
        // The decrement hands back the attempt the lease charged: the
        // delivery never started, so it must not burn retirement budget.
        attempts: { decrement: 1 },
        leasedUntil: null,
        leaseToken: null,
        updatedAt: asDate(params.now),
      },
    });
    return { applied: result.count === 1 };
  }

  async findDueWakes(params: {
    now: number;
    limit: number;
    processNames?: readonly string[];
  }): Promise<DueWake[]> {
    if (params.limit <= 0) return [];
    if (params.processNames && params.processNames.length === 0) return [];
    const processNameFilter = params.processNames
      ? Prisma.sql`AND "processName" IN (${Prisma.join([...params.processNames])})`
      : Prisma.empty;
    // Wake scanning is intentionally cross-project worker infrastructure;
    // every returned row still carries its project-scoped process identity.
    const rows = await this.prisma.$queryRaw<ProcessManagerInstance[]>(
      Prisma.sql`
        SELECT *
        FROM "ProcessManagerInstance"
        WHERE "nextWakeAt" <= ${asDate(params.now)}
        ${processNameFilter}
        ORDER BY "nextWakeAt" ASC, "processName" ASC,
                 "projectId" ASC, "processKey" ASC
        LIMIT ${params.limit}
      `,
    );
    return rows.flatMap((row) =>
      row.nextWakeAt === null
        ? []
        : [
            {
              ref: {
                processName: row.processName,
                projectId: row.projectId,
                processKey: row.processKey,
              },
              revision: row.revision,
              wakeAt: row.nextWakeAt.getTime(),
            },
          ],
    );
  }

  async requeueDeadMessages(params: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
    now: number;
  }): Promise<number> {
    const result = await this.prisma.processManagerOutbox.updateMany({
      where: {
        processName: params.processName,
        projectId: params.projectId,
        processKey: params.processKey,
        status: "dead",
        ...(params.messageKeyPrefix
          ? { messageKey: { startsWith: params.messageKeyPrefix } }
          : {}),
      },
      data: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: asDate(params.now),
        leasedUntil: null,
        leaseToken: null,
        updatedAt: asDate(params.now),
      },
    });
    return result.count;
  }

  async deleteDispatchedBefore(params: {
    processName: string;
    before: number;
  }): Promise<number> {
    // Cross-tenant retention sweep: this prunes dispatched outbox rows for a
    // process name across every project, so it has no `projectId` predicate
    // and the multitenancy guard would otherwise throw on every scheduled
    // prune tick. Opt out via the guard's sanctioned `-- @tenancy:` marker
    // (see dbMultiTenancyProtection.ts and the scheduler's due-scan in
    // scheduled-job.repository.ts for the same pattern) — this is a
    // system-owned maintenance sweep, not a tenant-scoped read/write.
    const affected = await this.prisma.$executeRaw`
      DELETE FROM "ProcessManagerOutbox"
      WHERE "processName" = ${params.processName}
        AND "status" = 'dispatched'::"ProcessManagerOutboxStatus"
        AND "dispatchedAt" < ${asDate(params.before)}
      -- @tenancy: process-manager outbox retention cross-tenant sweep (system-owned maintenance)
    `;
    return affected;
  }

  // The three batched sweeps below share one shape: pick at most `limit` ids
  // with a bounded SELECT, then delete exactly those. Putting the LIMIT in a
  // subquery rather than on the DELETE is what keeps one statement's lock
  // footprint bounded — an unbounded `DELETE ... WHERE age < x` against
  // millions of rows holds row locks for the whole scan and is exactly the
  // shape that made the pre-existing single-process prune unusable at volume.
  //
  // All three are cross-tenant by design (see the port docs), so each carries
  // the multitenancy guard's sanctioned `-- @tenancy:` marker, the same opt-out
  // `deleteDispatchedBefore` above already uses.

  async deleteDispatchedOutboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number> {
    if (params.limit <= 0) return 0;
    return await this.prisma.$executeRaw`
      DELETE FROM "ProcessManagerOutbox"
      WHERE "id" IN (
        SELECT "id" FROM "ProcessManagerOutbox"
        WHERE "status" = 'dispatched'::"ProcessManagerOutboxStatus"
          AND "dispatchedAt" < ${asDate(params.before)}
        LIMIT ${params.limit}
      )
      -- @tenancy: process-manager retention sweep, dispatched outbox (system-owned maintenance)
    `;
  }

  async deleteDeadOutboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number> {
    if (params.limit <= 0) return 0;
    // Dead rows carry no `deadAt`; `updatedAt` is stamped by the markFailed
    // that retired them, so it IS the moment the row became a failure record.
    // No new index: `dead` is a rare status, so the existing
    // (status, nextAttemptAt, leasedUntil) index already makes this selective.
    return await this.prisma.$executeRaw`
      DELETE FROM "ProcessManagerOutbox"
      WHERE "id" IN (
        SELECT "id" FROM "ProcessManagerOutbox"
        WHERE "status" = 'dead'::"ProcessManagerOutboxStatus"
          AND "updatedAt" < ${asDate(params.before)}
        LIMIT ${params.limit}
      )
      -- @tenancy: process-manager retention sweep, dead outbox (system-owned maintenance)
    `;
  }

  async deleteConsumedInboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number> {
    if (params.limit <= 0) return 0;
    return await this.prisma.$executeRaw`
      DELETE FROM "ProcessManagerInbox"
      WHERE "id" IN (
        SELECT "id" FROM "ProcessManagerInbox"
        WHERE "consumedAt" < ${asDate(params.before)}
        LIMIT ${params.limit}
      )
      -- @tenancy: process-manager retention sweep, consumed inbox (system-owned maintenance)
    `;
  }
}
