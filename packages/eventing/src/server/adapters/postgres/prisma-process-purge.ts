import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type { EventingProcessPersistenceDatabase } from "../../process-persistence.database.ts";
import type { ProcessPurgeTarget } from "./process-admin.types.ts";

const logger = createLogger("langwatch:eventing:process-purge");

/** The raw operations this purge performs; narrow on purpose, as its predicates span tenants. */
type ProcessPurgeDatabase = Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "$executeRawUnsafe">;

function isProcessPurgeDatabase(
  database: EventingProcessPersistenceDatabase,
): database is ProcessPurgeDatabase {
  return ["$queryRaw", "$executeRaw", "$executeRawUnsafe"].every(
    (name) => typeof Reflect.get(database, name) === "function",
  );
}

const TABLES: Record<ProcessPurgeTarget, string> = {
  "outbox-dispatched": "ProcessManagerOutbox",
  "inbox-consumed": "ProcessManagerInbox",
};

/**
 * The operator's retention purge over the process-manager tables (ARCHITECTURE.md §7, ET-1), in
 * `ctid` batches needing no index: drain a target by calling {@link deleteBatch} until it is zero.
 * Spec: packages/eventing/specs/event-table-surfaces.feature.
 */
export class PrismaProcessPurge {
  private constructor(private readonly database: ProcessPurgeDatabase) {}

  static create(options: { database: EventingProcessPersistenceDatabase }): PrismaProcessPurge {
    if (!isProcessPurgeDatabase(options.database)) {
      throw new Error("PrismaProcessPurge requires a generated Prisma client.");
    }
    return new PrismaProcessPurge(options.database);
  }

  /**
   * Every value is bound, never interpolated. The outbox window is one
   * retention period wider than the sweep's, so this only removes rows the
   * sweep would also remove.
   */
  async countEligible({
    target,
    retentionDays,
  }: {
    target: ProcessPurgeTarget;
    retentionDays: number;
  }): Promise<number> {
    const rows =
      target === "outbox-dispatched"
        ? await this.database.$queryRaw<{ n: bigint }[]>(Prisma.sql`
            -- @tenancy: cross-tenant process-manager retention; operator-gated
            SELECT count(*)::bigint AS n FROM "ProcessManagerOutbox"
            WHERE "status" = 'dispatched'
              AND "dispatchedAt" < now() - (${retentionDays}::int * interval '1 day')
          `)
        : await this.database.$queryRaw<{ n: bigint }[]>(Prisma.sql`
            -- @tenancy: cross-tenant process-manager retention; operator-gated
            SELECT count(*)::bigint AS n FROM "ProcessManagerInbox"
            WHERE "consumedAt" < now() - (${retentionDays}::int * interval '1 day')
          `);

    return Number(rows[0]?.n ?? 0);
  }

  async deleteBatch({
    target,
    retentionDays,
    batchSize,
  }: {
    target: ProcessPurgeTarget;
    retentionDays: number;
    batchSize: number;
  }): Promise<number> {
    if (target === "outbox-dispatched") {
      return this.database.$executeRaw(Prisma.sql`
        -- @tenancy: cross-tenant process-manager retention; operator-gated
        WITH batch AS (
          SELECT ctid FROM "ProcessManagerOutbox"
          WHERE "status" = 'dispatched'
            AND "dispatchedAt" < now() - (${retentionDays}::int * interval '1 day')
          LIMIT ${batchSize}
        )
        DELETE FROM "ProcessManagerOutbox" o USING batch WHERE o.ctid = batch.ctid
      `);
    }

    return this.database.$executeRaw(Prisma.sql`
      -- @tenancy: cross-tenant process-manager retention; operator-gated
      WITH batch AS (
        SELECT ctid FROM "ProcessManagerInbox"
        WHERE "consumedAt" < now() - (${retentionDays}::int * interval '1 day')
        LIMIT ${batchSize}
      )
      DELETE FROM "ProcessManagerInbox" i USING batch WHERE i.ctid = batch.ctid
    `);
  }

  /** A plain VACUUM marks pages reusable without VACUUM FULL's exclusive lock; never fatal. */
  async vacuum(): Promise<void> {
    for (const table of Object.values(TABLES)) {
      try {
        await this.database.$executeRawUnsafe(
          `-- @tenancy: cross-tenant process-manager housekeeping; operator-gated\nVACUUM (ANALYZE) "${table}"`,
        );
      } catch (error) {
        logger.warn({ error, table }, "the post-purge vacuum failed; the rows are still deleted");
      }
    }
  }
}
