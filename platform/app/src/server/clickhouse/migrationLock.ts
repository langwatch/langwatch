import type { PrismaClient } from "~/generated/prisma/client";

/**
 * Every app and workers pod runs the ClickHouse migrations at boot and goose
 * takes no lock on ClickHouse, so pods queue on this Postgres advisory lock.
 * @see specs/clickhouse/concurrent-boot-migrations.feature
 */
export const CLICKHOUSE_MIGRATION_LOCK_KEY = "clickhouse:migrate";

/** Covers the wait for another pod's run plus this pod's own run. */
export const CLICKHOUSE_MIGRATION_TXN_TIMEOUT_MS = 30 * 60_000;

export const CLICKHOUSE_MIGRATION_TXN_MAX_WAIT_MS = 30_000;

export const withClickHouseMigrationLock = async <T>(
  { prisma }: { prisma: PrismaClient },
  fn: () => Promise<T>,
): Promise<T> =>
  prisma.$transaction(
    async (tx) => {
      // `$executeRaw` because pg_advisory_xact_lock returns void.
      await tx.$executeRaw`-- @tenancy: global ClickHouse migration boot lock, no tenant scope
SELECT pg_advisory_xact_lock(hashtextextended(${CLICKHOUSE_MIGRATION_LOCK_KEY}, 0))`;
      // The session idles while goose works on ClickHouse; an idle timeout would drop the lock mid-run.
      await tx.$executeRaw`-- @tenancy: global ClickHouse migration boot lock session setting, no tenant scope
SET LOCAL idle_in_transaction_session_timeout = 0`;
      return fn();
    },
    {
      timeout: CLICKHOUSE_MIGRATION_TXN_TIMEOUT_MS,
      maxWait: CLICKHOUSE_MIGRATION_TXN_MAX_WAIT_MS,
    },
  );
