import type { UpgradePostgres } from "./ports.ts";

/**
 * The same DDL as the Prisma migrations `20261006130000_upgrade_ledger` and
 * `20261006180000_upgrade_ledger_widen`, so whichever creator runs first, the other converges
 * without drift. Unqualified: the schema comes from the connection.
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
  `ALTER TABLE "_langwatch_upgrade_step" ADD COLUMN IF NOT EXISTS "owner" TEXT`,
  `ALTER TABLE "_langwatch_upgrade_step" ADD COLUMN IF NOT EXISTS "description" TEXT`,
  `ALTER TABLE "_langwatch_upgrade_run" ADD COLUMN IF NOT EXISTS "floor" TEXT`,
  `CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_target" (
    "step_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_target_pkey" PRIMARY KEY ("step_id","target")
)`,
  `CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_lease" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_lease_pkey" PRIMARY KEY ("name")
)`,
  `CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_presence" (
    "process_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "release" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_presence_pkey" PRIMARY KEY ("process_id")
)`,
];

/** Creates the ledger tables and columns when absent; one already there is left as it is. */
export async function createLedgerTables({
  postgres,
}: {
  postgres: UpgradePostgres;
}): Promise<void> {
  for (const statement of LEDGER_TABLES_DDL) await postgres.query(statement);
}
