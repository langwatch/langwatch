import type { InferredStep } from "./ledger.ts";
import type { UpgradeClickHouse, UpgradePostgres } from "./ports.ts";

/** A `_prisma_migrations` row, as much of it as the seed reads. */
export interface PrismaMigrationRow {
  migration_name: string;
  finished: boolean;
  rolled_back: boolean;
  logs: string | null;
}

/** The latest `goose_db_version` row of one version. */
export interface GooseVersionRow {
  version_id: string | number;
  is_applied: number;
}

/** Reads Prisma's own history; a database Prisma never touched has none. */
export async function readPrismaMigrations({
  postgres,
}: {
  postgres: UpgradePostgres;
}): Promise<PrismaMigrationRow[]> {
  const { rows } = await postgres.query<{ present: boolean }>(
    `SELECT to_regclass('_prisma_migrations') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) return [];
  const history = await postgres.query<PrismaMigrationRow>(
    `SELECT "migration_name", "finished_at" IS NOT NULL AS "finished",
            "rolled_back_at" IS NOT NULL AS "rolled_back", "logs"
       FROM "_prisma_migrations" ORDER BY "migration_name", "started_at"`,
  );
  return history.rows;
}

/**
 * Reads goose's own history, the latest row per version; a database goose never touched has none.
 */
export async function readGooseVersions({
  clickhouse,
}: {
  clickhouse: UpgradeClickHouse;
}): Promise<GooseVersionRow[]> {
  const present = await clickhouse.queryRows<{ present: number }>(
    `SELECT count() AS present FROM system.tables
      WHERE database = currentDatabase() AND name = 'goose_db_version'`,
  );
  if (Number(present[0]?.present ?? 0) === 0) return [];
  return clickhouse.queryRows<GooseVersionRow>(
    `SELECT version_id, argMax(is_applied, tstamp) AS is_applied
       FROM goose_db_version GROUP BY version_id ORDER BY version_id`,
  );
}

/**
 * One postgres-schema step per migration folder: done when any row finished, failed when a row
 * neither finished nor was rolled back (Prisma's log is the error), pending when only rolled back.
 */
export function prismaSteps({ rows }: { rows: readonly PrismaMigrationRow[] }): InferredStep[] {
  const byName = new Map<string, PrismaMigrationRow[]>();
  for (const row of rows)
    byName.set(row.migration_name, [...(byName.get(row.migration_name) ?? []), row]);
  return [...byName].map(([name, attempts]) => {
    const step = { id: `prisma:${name}`, kind: "postgres-schema", mode: "blocking" } as const;
    if (attempts.some((row) => row.finished && !row.rolled_back)) {
      return { ...step, status: "done", lastError: null };
    }
    const failed = attempts.find((row) => !row.finished && !row.rolled_back);
    if (failed) return { ...step, status: "failed", lastError: failed.logs };
    return { ...step, status: "pending", lastError: null };
  });
}

/** One clickhouse-schema step per goose version but goose's bootstrap 0: done when applied last. */
export function gooseSteps({ rows }: { rows: readonly GooseVersionRow[] }): InferredStep[] {
  return rows
    .filter((row) => Number(row.version_id) !== 0)
    .map((row) => ({
      id: `clickhouse:${String(row.version_id).padStart(5, "0")}`,
      kind: "clickhouse-schema",
      mode: "blocking",
      status: Number(row.is_applied) === 1 ? "done" : "pending",
      lastError: null,
    }));
}
