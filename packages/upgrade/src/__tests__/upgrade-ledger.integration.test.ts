/**
 * @vitest-environment node
 * @see specs/setup/upgrade-ledger.feature
 * Requires LANGWATCH_TEST_DATABASE_URL and LANGWATCH_TEST_CLICKHOUSE_URL; every test gets its own
 * Postgres schema and ClickHouse database, so the shared test databases are never touched.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpgradeLedgerSeedService } from "../ledger-seed.service.ts";
import { createLedgerTables } from "../ledger-tables.ts";
import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpgradeClickHouse } from "../ports.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const CH_URL = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;

const PRISMA_DIR = fileURLToPath(new URL("../../../prisma-client/prisma/", import.meta.url));
const LEDGER_MIGRATION = join(PRISMA_DIR, "migrations/20261006130000_upgrade_ledger/migration.sql");
const PRISMA_BIN = fileURLToPath(new URL("../../node_modules/.bin/prisma", import.meta.url));

let sequence = 0;
const scratchName = () => `upgrade_ledger_${Date.now().toString(36)}_${sequence++}`;

interface Scratch {
  name: string;
  postgres: Pool;
  clickhouse: UpgradeClickHouse;
  clickhouseClient: ClickHouseClient;
  drop(): Promise<void>;
}

async function openScratch(): Promise<Scratch> {
  const name = scratchName();
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${name}"`);
  const postgres = new Pool({
    connectionString: DB_URL,
    max: 2,
    options: `-c search_path=${name}`,
  });
  const root = createClient({ url: CH_URL });
  await root.command({ query: `CREATE DATABASE ${name}` });
  const clickhouseClient = createClient({ url: CH_URL, database: name });
  const clickhouse: UpgradeClickHouse = {
    queryRows: async (sql) =>
      (await clickhouseClient.query({ query: sql, format: "JSONEachRow" })).json(),
  };
  return {
    name,
    postgres,
    clickhouse,
    clickhouseClient,
    drop: async () => {
      await postgres.end();
      await admin.query(`DROP SCHEMA "${name}" CASCADE`);
      await admin.end();
      await clickhouseClient.close();
      await root.command({ query: `DROP DATABASE IF EXISTS ${name}` });
      await root.close();
    },
  };
}

/** Prisma's own `_prisma_migrations` DDL. */
async function givenPrismaHistory(
  scratch: Scratch,
  rows: { name: string; finished?: boolean; rolledBack?: boolean; logs?: string }[],
): Promise<void> {
  await scratch.postgres.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  for (const row of rows) {
    await scratch.postgres.query(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "rolled_back_at", "logs")
       VALUES (gen_random_uuid()::text, 'checksum', $1, $2, $3, $4)`,
      [
        row.name,
        row.finished ? new Date() : null,
        row.rolledBack ? new Date() : null,
        row.logs ?? null,
      ],
    );
  }
}

/** goose_db_version as the runner pre-creates it (goose.migration-runner.ts). */
async function givenGooseHistory(
  scratch: Scratch,
  rows: { version: number; applied: boolean; at: string }[],
): Promise<void> {
  await scratch.clickhouseClient.command({
    query: `CREATE TABLE IF NOT EXISTS goose_db_version (
      version_id Int64, is_applied UInt8, date Date DEFAULT now(), tstamp DateTime DEFAULT now()
    ) ENGINE = MergeTree() ORDER BY date`,
  });
  if (rows.length === 0) return;
  await scratch.clickhouseClient.insert({
    table: "goose_db_version",
    format: "JSONEachRow",
    values: rows.map((row) => ({
      version_id: row.version,
      is_applied: row.applied ? 1 : 0,
      tstamp: row.at,
    })),
  });
}

const seed = (scratch: Scratch) =>
  UpgradeLedgerSeedService.create({
    postgres: scratch.postgres,
    clickhouse: scratch.clickhouse,
  }).seed();

const ledgerOf = (scratch: Scratch) =>
  UpgradeLedgerRepository.create({ postgres: scratch.postgres });

async function describeTables(postgres: Pool, schema: string): Promise<unknown> {
  const columns = await postgres.query(
    `SELECT table_name, column_name, ordinal_position, data_type, datetime_precision,
            is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = $1
      ORDER BY table_name, ordinal_position`,
    [schema],
  );
  const constraints = await postgres.query(
    `SELECT conrelid::regclass::text AS on_table, conname, contype, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 ORDER BY conname`,
    [schema],
  );
  const indexes = await postgres.query(
    `SELECT tablename, indexname, replace(indexdef, $1, 'SCHEMA.') AS def
       FROM pg_indexes WHERE schemaname = $2 ORDER BY indexname`,
    [`${schema}.`, schema],
  );
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

/** `prisma migrate diff` from the scratch schema to the ledger's two models; 0 means no drift. */
async function prismaDriftExitCode(schema: string): Promise<number> {
  const prismaSchema = await readFile(join(PRISMA_DIR, "schema.prisma"), "utf8");
  const models = [...prismaSchema.matchAll(/^model LangwatchUpgrade\w+ \{[\s\S]*?^\}/gm)].map(
    (match) => match[0],
  );
  expect(models).toHaveLength(2);
  const dir = await mkdtemp(join(tmpdir(), "upgrade-ledger-"));
  try {
    const url = new URL(DB_URL ?? "");
    url.searchParams.set("schema", schema);
    await writeFile(
      join(dir, "ledger.prisma"),
      `datasource db {\n  provider = "postgresql"\n}\n\n${models.join("\n\n")}\n`,
    );
    await writeFile(
      join(dir, "prisma.config.mjs"),
      `export default ${JSON.stringify({ schema: "./ledger.prisma", datasource: { url: url.toString() } })};\n`,
    );
    const run = promisify(execFile)(
      PRISMA_BIN,
      [
        "migrate",
        "diff",
        "--config",
        join(dir, "prisma.config.mjs"),
        "--from-config-datasource",
      ].concat(["--to-schema", join(dir, "ledger.prisma"), "--exit-code"]),
      { cwd: dir, env: { ...process.env, CHECKPOINT_DISABLE: "1" } },
    );
    return await run.then(
      () => 0,
      (error: { code?: number }) => error.code ?? 1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!DB_URL || !CH_URL)("the upgrade ledger", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await openScratch();
  });

  afterEach(async () => {
    await scratch.drop();
  });

  describe("when the ledger is created", () => {
    /** @scenario "Creating the ledger leaves Prisma's migration history in sync" */
    it("creates the same tables as Prisma's migration, with no drift from Prisma's models", async () => {
      const migrated = await openScratch();
      try {
        await migrated.postgres.query(await readFile(LEDGER_MIGRATION, "utf8"));
        await createLedgerTables({ postgres: scratch.postgres });

        const present = await scratch.postgres.query<{ run: string | null; step: string | null }>(
          `SELECT to_regclass('_langwatch_upgrade_run')::text AS run,
                  to_regclass('_langwatch_upgrade_step')::text AS step`,
        );
        expect(present.rows[0]).toEqual({
          run: "_langwatch_upgrade_run",
          step: "_langwatch_upgrade_step",
        });
        expect(await describeTables(scratch.postgres, scratch.name)).toEqual(
          await describeTables(migrated.postgres, migrated.name),
        );
        expect(await prismaDriftExitCode(scratch.name)).toBe(0);
        expect(await prismaDriftExitCode(migrated.name)).toBe(0);
      } finally {
        await migrated.drop();
      }
    });

    /** @scenario "Creating the ledger twice changes nothing" */
    it("leaves a recorded step exactly as it was when created again", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await scratch.postgres.query(
        `INSERT INTO "_langwatch_upgrade_step" ("id", "kind", "mode", "status", "attempt", "updated_at")
         VALUES ('prisma:20260101000000_recorded', 'postgres-schema', 'blocking', 'done', 1, now())`,
      );
      const before = await ledger.findSteps();

      await ledger.createTables();

      expect(before).toHaveLength(1);
      expect(await ledger.findSteps()).toEqual(before);
    });
  });

  describe("when Prisma's history is seeded", () => {
    /** @scenario "Every applied Prisma migration is seeded as a done schema step" */
    it("records each finished migration as a done, inferred postgres-schema step with no release", async () => {
      await givenPrismaHistory(scratch, [
        { name: "20260101000000_first", finished: true },
        { name: "20260102000000_second", finished: true },
      ]);

      await seed(scratch);

      const steps = await ledgerOf(scratch).findSteps();
      expect(steps.map((step) => step.id)).toEqual([
        "prisma:20260101000000_first",
        "prisma:20260102000000_second",
      ]);
      for (const step of steps) {
        expect(step).toMatchObject({
          kind: "postgres-schema",
          status: "done",
          inferred: true,
          release: null,
        });
      }
    });

    /** @scenario "A Prisma migration that failed and was never resolved is seeded as failed" */
    it("records an unresolved failure as failed, carrying Prisma's log", async () => {
      await givenPrismaHistory(scratch, [
        { name: "20260101000000_broken", logs: "relation-marker does not exist" },
      ]);

      await seed(scratch);

      expect(await ledgerOf(scratch).findSteps()).toEqual([
        expect.objectContaining({
          id: "prisma:20260101000000_broken",
          status: "failed",
          inferred: true,
          lastError: "relation-marker does not exist",
        }),
      ]);
    });

    /** @scenario "A Prisma migration resolved as rolled back is not seeded as done" */
    it("records a migration only ever rolled back as pending", async () => {
      await givenPrismaHistory(scratch, [
        { name: "20260101000000_rolled_back", rolledBack: true, logs: "failed once" },
      ]);

      await seed(scratch);

      expect(await ledgerOf(scratch).findSteps()).toEqual([
        expect.objectContaining({ id: "prisma:20260101000000_rolled_back", status: "pending" }),
      ]);
    });
  });

  describe("when goose's history is seeded", () => {
    /** @scenario "Every applied goose version is seeded as a done ClickHouse schema step" */
    it("records each applied version as a done, inferred clickhouse-schema step and skips version 0", async () => {
      await givenGooseHistory(scratch, [
        { version: 0, applied: true, at: "2026-01-01 00:00:00" },
        { version: 1, applied: true, at: "2026-01-01 00:00:01" },
        { version: 2, applied: true, at: "2026-01-01 00:00:02" },
      ]);

      await seed(scratch);

      const steps = await ledgerOf(scratch).findSteps();
      expect(steps.map((step) => step.id)).toEqual(["clickhouse:00001", "clickhouse:00002"]);
      for (const step of steps) {
        expect(step).toMatchObject({
          kind: "clickhouse-schema",
          status: "done",
          inferred: true,
          release: null,
        });
      }
    });

    /** @scenario "A goose version migrated down is not seeded as done" */
    it("records a version whose latest row is not applied as pending", async () => {
      await givenGooseHistory(scratch, [
        { version: 0, applied: true, at: "2026-01-01 00:00:00" },
        { version: 3, applied: true, at: "2026-01-01 00:00:01" },
        { version: 3, applied: false, at: "2026-01-01 00:00:05" },
      ]);

      await seed(scratch);

      expect(await ledgerOf(scratch).findSteps()).toEqual([
        expect.objectContaining({ id: "clickhouse:00003", status: "pending" }),
      ]);
    });
  });

  describe("when the ledger is seeded again", () => {
    /** @scenario "Seeding twice records each step once" */
    it("keeps one row per step, holding the status the second read found", async () => {
      await givenPrismaHistory(scratch, [{ name: "20260101000000_retried", logs: "first try" }]);
      await givenGooseHistory(scratch, [{ version: 1, applied: true, at: "2026-01-01 00:00:01" }]);
      await seed(scratch);

      await givenPrismaHistory(scratch, [{ name: "20260101000000_retried", finished: true }]);
      await seed(scratch);

      expect(await ledgerOf(scratch).findSteps()).toEqual([
        expect.objectContaining({ id: "clickhouse:00001", status: "done" }),
        expect.objectContaining({
          id: "prisma:20260101000000_retried",
          status: "done",
          lastError: null,
        }),
      ]);
    });

    /** @scenario "Seeding never overwrites a step the runner recorded itself" */
    it("keeps the runner's own step and its status", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await scratch.postgres.query(
        `INSERT INTO "_langwatch_upgrade_step" ("id", "kind", "mode", "status", "attempt", "updated_at")
         VALUES ('prisma:20260101000000_observed', 'postgres-schema', 'blocking', 'done', 1, now())`,
      );
      await givenPrismaHistory(scratch, [
        { name: "20260101000000_observed", logs: "hand-patched" },
      ]);

      await seed(scratch);

      expect(await ledger.findSteps()).toEqual([
        expect.objectContaining({
          id: "prisma:20260101000000_observed",
          status: "done",
          inferred: false,
          lastError: null,
        }),
      ]);
    });
  });

  describe("when a seed runs", () => {
    /** @scenario "Seeding is itself recorded as a run" */
    it("records a finished seed run counting its steps by kind", async () => {
      await givenPrismaHistory(scratch, [
        { name: "20260101000000_first", finished: true },
        { name: "20260102000000_second", finished: true },
      ]);
      await givenGooseHistory(scratch, [
        { version: 0, applied: true, at: "2026-01-01 00:00:00" },
        { version: 1, applied: true, at: "2026-01-01 00:00:01" },
      ]);

      const run = await seed(scratch);

      expect(await ledgerOf(scratch).findRuns()).toEqual([run]);
      expect(run).toMatchObject({
        kind: "seed",
        outcome: "succeeded",
        report: { seeded: { "postgres-schema": 2, "clickhouse-schema": 1 } },
      });
      expect(run.startedAt).toBeInstanceOf(Date);
      expect(run.finishedAt?.getTime()).toBeGreaterThanOrEqual(run.startedAt.getTime());
    });

    /** @scenario "A fresh database seeds an empty ledger" */
    it("records no step on a database no migration has touched, and still records the run", async () => {
      const run = await seed(scratch);

      expect(await ledgerOf(scratch).findSteps()).toEqual([]);
      expect(await ledgerOf(scratch).findRuns()).toEqual([
        expect.objectContaining({
          id: run.id,
          kind: "seed",
          outcome: "succeeded",
          report: { seeded: {} },
        }),
      ]);
    });
  });
});
