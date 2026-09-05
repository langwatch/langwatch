import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  ProcessManagerPurgeRepository,
  type ProcessManagerPurgeTarget,
} from "../process-manager-purge.repository";

const logger = createLogger("langwatch:ops:process-manager-purge");

/**
 * Exactly the raw operations this purge performs, picked from the real client
 * rather than re-declared, so a typed `PrismaClient` satisfies it with no cast.
 * Narrow on purpose: these predicates are cross-tenant by design.
 */
export type ProcessManagerPurgeDatabase = Pick<
  PrismaClient,
  "$queryRaw" | "$executeRaw" | "$executeRawUnsafe"
>;

const TABLES: Record<ProcessManagerPurgeTarget, string> = {
  "outbox-dispatched": "ProcessManagerOutbox",
  "inbox-consumed": "ProcessManagerInbox",
};

export class PrismaProcessManagerPurgeRepository extends ProcessManagerPurgeRepository {
  private constructor(private readonly database: ProcessManagerPurgeDatabase) {
    super();
  }

  static create(options: {
    database: ProcessManagerPurgeDatabase;
  }): PrismaProcessManagerPurgeRepository {
    return new PrismaProcessManagerPurgeRepository(options.database);
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
    target: ProcessManagerPurgeTarget;
    retentionDays: number;
  }): Promise<number> {
    const rows =
      target === "outbox-dispatched"
        ? await this.database.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
            -- @tenancy: cross-tenant process-manager retention; ops-gated
            SELECT count(*)::bigint AS n FROM "ProcessManagerOutbox"
            WHERE "status" = 'dispatched'
              AND "dispatchedAt" < now() - (${retentionDays}::int * interval '1 day')
          `)
        : await this.database.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
            -- @tenancy: cross-tenant process-manager retention; ops-gated
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
    target: ProcessManagerPurgeTarget;
    retentionDays: number;
    batchSize: number;
  }): Promise<number> {
    if (target === "outbox-dispatched") {
      return this.database.$executeRaw(Prisma.sql`
        -- @tenancy: cross-tenant process-manager retention; ops-gated
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
      -- @tenancy: cross-tenant process-manager retention; ops-gated
      WITH batch AS (
        SELECT ctid FROM "ProcessManagerInbox"
        WHERE "consumedAt" < now() - (${retentionDays}::int * interval '1 day')
        LIMIT ${batchSize}
      )
      DELETE FROM "ProcessManagerInbox" i USING batch WHERE i.ctid = batch.ctid
    `);
  }

  async vacuum(): Promise<void> {
    for (const table of Object.values(TABLES)) {
      try {
        await this.database.$executeRawUnsafe(
          `-- @tenancy: cross-tenant process-manager housekeeping; ops-gated\nVACUUM (ANALYZE) "${table}"`,
        );
      } catch (error) {
        logger.warn({ error, table }, "the post-purge vacuum failed; the rows are still deleted");
      }
    }
  }
}
