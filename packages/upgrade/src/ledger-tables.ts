import type { UpgradePostgres } from "./ports.ts";

/**
 * The same DDL as the Prisma migration `20261006130000_upgrade_ledger`, so whichever creator runs
 * first, the other converges without drift. Unqualified: the schema comes from the connection.
 */
export const LEDGER_TABLES_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_run" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "release" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "outcome" TEXT,
    "plan" JSONB,
    "report" JSONB,

    CONSTRAINT "_langwatch_upgrade_run_pkey" PRIMARY KEY ("id")
)`,
  `CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_step" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "release" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inferred" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "report" JSONB,
    "run_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_step_pkey" PRIMARY KEY ("id")
)`,
];

/** Creates both ledger tables when absent; a table already there is left exactly as it is. */
export async function createLedgerTables({
  postgres,
}: {
  postgres: UpgradePostgres;
}): Promise<void> {
  for (const statement of LEDGER_TABLES_DDL) await postgres.query(statement);
}
