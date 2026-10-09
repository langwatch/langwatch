import type { UpgradePostgres } from "./ports.ts";

/**
 * The ledger lives in its own Postgres schema beside the installation's (round 21), so it exists
 * before Prisma's first deploy, which refuses a non-empty schema it has no record of (P3005).
 */
export const LEDGER_SCHEMA_SUFFIX = "_upgrade_ledger";

/** Quoted, schema-qualified names of the ledger's tables, ready to splice into SQL. */
export type LedgerTableNames = {
  schema: string;
  run: string;
  step: string;
  target: string;
  lease: string;
  roster: string;
  tenantState: string;
};

/** The unqualified table names inside the ledger schema. */
export const LEDGER_TABLE = {
  run: "_langwatch_upgrade_run",
  step: "_langwatch_upgrade_step",
  target: "_langwatch_upgrade_target",
  lease: "_langwatch_upgrade_lease",
  roster: "_langwatch_serving_roster",
  tenantState: "_langwatch_upgrade_tenant_state",
} as const;

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** The ledger schema of an installation whose Prisma schema is `installationSchema`. */
export function ledgerSchemaOf({ installationSchema }: { installationSchema: string }): string {
  return `${installationSchema}${LEDGER_SCHEMA_SUFFIX}`;
}

/** The ledger's table names inside `schema` (the ledger schema, not the installation's). */
export function ledgerTablesIn({ schema }: { schema: string }): LedgerTableNames {
  const qualified = (table: string) => `${quote(schema)}.${quote(table)}`;
  return {
    schema,
    run: qualified(LEDGER_TABLE.run),
    step: qualified(LEDGER_TABLE.step),
    target: qualified(LEDGER_TABLE.target),
    lease: qualified(LEDGER_TABLE.lease),
    roster: qualified(LEDGER_TABLE.roster),
    tenantState: qualified(LEDGER_TABLE.tenantState),
  };
}

/** The connection's schema, or the first one its search_path names while it does not exist. */
const INSTALLATION_SCHEMA_SQL = `SELECT coalesce(
  current_schema(),
  nullif(btrim(split_part(current_setting('search_path'), ',', 1), ' "'), '$user'),
  'public'
) AS "schema"`;

const resolved = new WeakMap<UpgradePostgres, Promise<LedgerTableNames>>();

/**
 * The ledger tables of the installation this connection reaches: one ledger per Prisma schema,
 * as when the tables sat unqualified in it. Resolved once per connection.
 */
export function ledgerTables({
  postgres,
}: {
  postgres: UpgradePostgres;
}): Promise<LedgerTableNames> {
  const known = resolved.get(postgres);
  if (known) return known;
  const pending = postgres.query<{ schema: string }>(INSTALLATION_SCHEMA_SQL).then(({ rows }) => {
    const installationSchema = rows[0]?.schema ?? "public";
    return ledgerTablesIn({ schema: ledgerSchemaOf({ installationSchema }) });
  });
  resolved.set(postgres, pending);
  pending.catch(() => resolved.delete(postgres));
  return pending;
}

/** The ledger's DDL inside its schema: re-runnable, additive, one statement each. */
export function ledgerTablesDdl({ tables }: { tables: LedgerTableNames }): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${tables.run} (
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
    `CREATE TABLE IF NOT EXISTS ${tables.step} (
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
    `ALTER TABLE ${tables.step} ADD COLUMN IF NOT EXISTS "owner" TEXT`,
    `ALTER TABLE ${tables.step} ADD COLUMN IF NOT EXISTS "description" TEXT`,
    `ALTER TABLE ${tables.run} ADD COLUMN IF NOT EXISTS "floor" TEXT`,
    `CREATE TABLE IF NOT EXISTS ${tables.target} (
    "step_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_target_pkey" PRIMARY KEY ("step_id","target")
)`,
    `CREATE TABLE IF NOT EXISTS ${tables.lease} (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_lease_pkey" PRIMARY KEY ("name")
)`,
    `CREATE TABLE IF NOT EXISTS ${tables.roster} (
    "process_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "release" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_serving_roster_pkey" PRIMARY KEY ("process_id")
)`,
    `CREATE TABLE IF NOT EXISTS ${tables.tenantState} (
    "step_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "report" JSONB,
    "held_reason" TEXT,
    "held_since" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_langwatch_upgrade_tenant_state_pkey" PRIMARY KEY ("step_id", "tenant_id")
)`,
  ];
}

/** Serialises concurrent creators of one installation's ledger for the rest of the transaction. */
const lockOf = ({ tables }: { tables: LedgerTableNames }) =>
  `PERFORM pg_advisory_xact_lock(hashtext(${literal(`langwatch-upgrade-ledger:${tables.schema}`)}));`;

/**
 * One statement, one transaction: the schema (created only when absent, so an operator may
 * pre-create it for a role without CREATE on the database) and every table, under a lock.
 */
export function createLedgerTablesSql({ tables }: { tables: LedgerTableNames }): string {
  const body = ledgerTablesDdl({ tables }).map((statement) => `  ${statement};`);
  return [
    "DO $ledger$",
    "BEGIN",
    `  ${lockOf({ tables })}`,
    `  IF to_regnamespace(${literal(quote(tables.schema))}) IS NULL THEN`,
    `    CREATE SCHEMA ${quote(tables.schema)};`,
    "  END IF;",
    ...body,
    "END",
    "$ledger$",
  ].join("\n");
}

/** Creates the ledger schema, tables and columns when absent; one already there stays as it is. */
export async function createLedgerTables({
  postgres,
}: {
  postgres: UpgradePostgres;
}): Promise<LedgerTableNames> {
  const tables = await ledgerTables({ postgres });
  await postgres.query(createLedgerTablesSql({ tables }));
  return tables;
}
