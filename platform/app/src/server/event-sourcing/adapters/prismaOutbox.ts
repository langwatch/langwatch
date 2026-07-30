import type { Outbox, OutboxRow } from "@langwatch/event-sourcing";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";

/** `intentType` is `${processManagerName}/${key}` (ADR-107 decision 16); the
 * process name is always its first segment, and intent keys are validated to
 * never contain a separator, so this split is unambiguous. */
function processNameOf(intentType: string): string {
  return intentType.split("/")[0] ?? "";
}

export function prismaOutbox(prisma: PrismaClient): Outbox {
  return {
    async stage(rows): Promise<void> {
      if (rows.length === 0) return;
      const now = new Date();
      await prisma.processManagerOutbox.createMany({
        data: rows.map((row) => ({
          id: generate(KSUID_RESOURCES.PROCESS_MANAGER_OUTBOX).toString(),
          processName: processNameOf(row.intentType),
          // The Outbox port carries no per-instance projectId/processKey at
          // intent time — tenantId is the closest available scope for the
          // deployed table's uniqueness, and messageKey is the only
          // per-row-unique value on hand for the NOT NULL processKey column.
          projectId: row.tenantId,
          processKey: row.messageKey,
          tenantId: row.tenantId,
          messageKey: row.messageKey,
          intentType: row.intentType,
          payload: row.payload,
          traceCarrier: {},
          status: "pending",
          attempts: 0,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        })),
        // messageKey collapses redeliveries of one logical intent — enforced
        // by the deployed (processName, projectId, messageKey) unique index,
        // so a race between two stagers can only ever leave one row.
        skipDuplicates: true,
      });
    },

    async claim(limit, leaseMs): Promise<readonly OutboxRow[]> {
      const now = new Date();
      const leasedUntil = new Date(now.getTime() + leaseMs);
      const rows = await prisma.$queryRaw<
        {
          id: string;
          intentType: string;
          messageKey: string;
          tenantId: string;
          payload: string;
          attempt: number;
        }[]
      >`
        -- @tenancy: cross-tenant outbox dispatch poll — one shared dispatcher
        -- serves every tenant and process manager (ADR-108 decision 11).
        WITH claimable AS (
          SELECT id FROM "ProcessManagerOutbox"
          WHERE status = 'pending'
            AND "nextAttemptAt" <= ${now}
            AND ("leasedUntil" IS NULL OR "leasedUntil" <= ${now})
          ORDER BY "nextAttemptAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ),
        leased AS (
          SELECT id, gen_random_uuid()::text AS token FROM claimable
        )
        UPDATE "ProcessManagerOutbox" AS o
        SET "leasedUntil" = ${leasedUntil}, "leaseToken" = leased.token, "updatedAt" = ${now}
        FROM leased
        WHERE o.id = leased.id
        RETURNING o.id, o."intentType", o."messageKey", o."tenantId", o.payload, o.attempts AS attempt
      `;
      return rows.map((row) => ({
        id: row.id,
        intentType: row.intentType,
        messageKey: row.messageKey,
        tenantId: row.tenantId,
        payload: row.payload,
        attempt: row.attempt,
      }));
    },

    async settle(id): Promise<void> {
      const now = new Date();
      // @tenancy: scoped by its own globally-unique id, the same bounded
      // shape as the VirtualKey findUnique-by-id exemption.
      await prisma.$executeRaw`
        UPDATE "ProcessManagerOutbox"
        SET status = 'dispatched',
            "dispatchedAt" = ${now},
            "leasedUntil" = NULL,
            "leaseToken" = NULL,
            "updatedAt" = ${now}
        WHERE id = ${id}
      `;
    },

    async fail(id, retryable, afterMs): Promise<void> {
      const now = new Date();
      // @tenancy: scoped by its own globally-unique id.
      if (retryable) {
        await prisma.$executeRaw`
          UPDATE "ProcessManagerOutbox"
          SET attempts = attempts + 1,
              status = 'pending',
              "nextAttemptAt" = ${new Date(now.getTime() + afterMs)},
              "leasedUntil" = NULL,
              "leaseToken" = NULL,
              "updatedAt" = ${now}
          WHERE id = ${id}
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE "ProcessManagerOutbox"
          SET attempts = attempts + 1,
              status = 'dead',
              "leasedUntil" = NULL,
              "leaseToken" = NULL,
              "updatedAt" = ${now}
          WHERE id = ${id}
        `;
      }
    },

    async prune(processName, before): Promise<number> {
      // @tenancy: cross-tenant retention sweep, scoped to one process's
      // dispatched history by processName — never unscoped (a live bug this
      // must not reintroduce).
      const removed = await prisma.$executeRaw`
        DELETE FROM "ProcessManagerOutbox"
        WHERE "processName" = ${processName}
          AND status = 'dispatched'
          AND "dispatchedAt" < ${new Date(before)}
      `;
      return removed;
    },
  };
}
