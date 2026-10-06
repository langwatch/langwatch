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
const LEDGER_MIGRATIONS = [
  "20261006130000_upgrade_ledger",
  "20261006180000_upgrade_ledger_widen",
].map((folder) => join(PRISMA_DIR, "migrations", folder, "migration.sql"));
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

/** `prisma migrate diff` from the scratch schema to the ledger's models; 0 means no drift. */
async function prismaDriftExitCode(schema: string): Promise<number> {
  const prismaSchema = await readFile(join(PRISMA_DIR, "schema.prisma"), "utf8");
  const models = [...prismaSchema.matchAll(/^model LangwatchUpgrade\w+ \{[\s\S]*?^\}/gm)].map(
    (match) => match[0],
  );
  expect(models).toHaveLength(5);
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
        for (const file of LEDGER_MIGRATIONS) {
          await migrated.postgres.query(await readFile(file, "utf8"));
        }
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

  describe("when the widened ledger is created", () => {
    /** @scenario "Creating the widened ledger gives the same shape as Prisma's migration" */
    it("matches Prisma's migrations when the runner widens an S1 ledger, with no drift", async () => {
      const migrated = await openScratch();
      try {
        for (const file of LEDGER_MIGRATIONS) {
          await migrated.postgres.query(await readFile(file, "utf8"));
        }
        await scratch.postgres.query(await readFile(LEDGER_MIGRATIONS[0] as string, "utf8"));
        await createLedgerTables({ postgres: scratch.postgres });

        expect(await describeTables(scratch.postgres, scratch.name)).toEqual(
          await describeTables(migrated.postgres, migrated.name),
        );
        expect(await prismaDriftExitCode(scratch.name)).toBe(0);
        expect(await prismaDriftExitCode(migrated.name)).toBe(0);
      } finally {
        await migrated.drop();
      }
    });

    /** @scenario "Widening a ledger that holds a recorded step keeps the step" */
    it("keeps a step recorded before the widening and leaves its owner and description empty", async () => {
      await scratch.postgres.query(await readFile(LEDGER_MIGRATIONS[0] as string, "utf8"));
      await scratch.postgres.query(
        `INSERT INTO "_langwatch_upgrade_step" ("id", "kind", "mode", "status", "attempt", "updated_at")
         VALUES ('prisma:20260101000000_recorded', 'postgres-schema', 'blocking', 'done', 1, now())`,
      );

      await ledgerOf(scratch).createTables();

      expect(await ledgerOf(scratch).findSteps()).toEqual([
        expect.objectContaining({
          id: "prisma:20260101000000_recorded",
          status: "done",
          owner: null,
          description: null,
        }),
      ]);
    });
  });

  describe("when targets are recorded", () => {
    /** @scenario "A target is stored per step and updated in place" */
    it("holds one row per target, updated in place, with a second target beside it", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await ledger.upsertTarget({
        stepId: "clickhouse:00007",
        target: "shared",
        status: "failed",
        lastError: "connection refused",
      });

      await ledger.upsertTarget({
        stepId: "clickhouse:00007",
        target: "shared",
        status: "done",
        version: "7",
      });
      await ledger.upsertTarget({ stepId: "clickhouse:00007", target: "org-a", status: "pending" });

      expect(await ledger.findTargets({ stepId: "clickhouse:00007" })).toEqual([
        expect.objectContaining({ target: "org-a", status: "pending", version: null }),
        expect.objectContaining({
          target: "shared",
          status: "done",
          version: "7",
          lastError: null,
        }),
      ]);
    });

    /** @scenario "Targets are listed per step only" */
    it("lists only the targets of the step asked for", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await ledger.upsertTarget({ stepId: "clickhouse:00001", target: "shared", status: "done" });
      await ledger.upsertTarget({ stepId: "clickhouse:00002", target: "shared", status: "done" });

      const targets = await ledger.findTargets({ stepId: "clickhouse:00002" });

      expect(targets.map((target) => target.stepId)).toEqual(["clickhouse:00002"]);
    });
  });

  describe("when the runner lease is contended", () => {
    const runner = (owner: string) => ({
      name: "upgrade",
      owner,
      image: `image-${owner}`,
      host: `host-${owner}`,
    });

    /** @scenario "A lease held by a live owner is refused" */
    it("refuses a second runner while the first one's lease is live", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await ledger.acquireLease({ ...runner("a"), ttlMs: 60_000 });

      const refused = await ledger.acquireLease({ ...runner("b"), ttlMs: 60_000 });

      expect(refused).toBeNull();
      expect(await ledger.renewLease({ name: "upgrade", owner: "a", ttlMs: 60_000 })).toMatchObject(
        { owner: "a", image: "image-a" },
      );
    });

    /** @scenario "An expired lease is taken over" */
    it("lets another runner take a lease once it has expired", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await ledger.acquireLease({ ...runner("a"), ttlMs: 1 });
      await new Promise((resolve) => setTimeout(resolve, 30));

      const taken = await ledger.acquireLease({ ...runner("b"), ttlMs: 60_000 });

      expect(taken).toMatchObject({ owner: "b", image: "image-b", host: "host-b" });
      expect(taken?.expiresAt.getTime()).toBeGreaterThan(taken?.heartbeatAt.getTime() ?? Infinity);
    });

    /** @scenario "A lease is renewed and released only by its owner" */
    it("renews and releases a lease for its owner and for nobody else", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      const held = await ledger.acquireLease({ ...runner("a"), ttlMs: 60_000 });

      expect(await ledger.renewLease({ name: "upgrade", owner: "b", ttlMs: 60_000 })).toBeNull();
      expect(await ledger.releaseLease({ name: "upgrade", owner: "b" })).toBe(false);
      const renewed = await ledger.renewLease({ name: "upgrade", owner: "a", ttlMs: 120_000 });
      expect(renewed?.expiresAt.getTime()).toBeGreaterThan(held?.expiresAt.getTime() ?? Infinity);
      expect(await ledger.releaseLease({ name: "upgrade", owner: "a" })).toBe(true);
      expect(await ledger.acquireLease({ ...runner("b"), ttlMs: 60_000 })).toMatchObject({
        owner: "b",
      });
    });
  });

  describe("when serving processes report presence", () => {
    const serving = (processId: string, steps: string[]) => ({
      processId,
      role: "worker",
      image: "git-abc123",
      release: null,
      steps,
    });

    /** @scenario "A process writes its presence and refreshes it in place" */
    it("keeps one row per process, refreshed with its steps and its original start", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      const first = await ledger.writePresence(serving("p1", ["a:one", "a:two"]));

      const second = await ledger.writePresence(serving("p1", ["a:one", "a:two", "a:three"]));

      const live = await ledger.findLivePresence({ staleAfterMs: 60_000 });
      expect(live).toEqual([second]);
      expect(second.steps).toEqual(["a:one", "a:two", "a:three"]);
      expect(second.startedAt).toEqual(first.startedAt);
      expect(second.heartbeatAt.getTime()).toBeGreaterThanOrEqual(first.heartbeatAt.getTime());
    });

    /** @scenario "A presence row older than the stale bound is not live" */
    it("does not return a process whose last write is older than the stale bound", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await ledger.writePresence(serving("old", []));
      await scratch.postgres.query(
        `UPDATE "_langwatch_upgrade_presence" SET "heartbeat_at" = "heartbeat_at" - interval '10 minutes'
          WHERE "process_id" = 'old'`,
      );
      await ledger.writePresence(serving("recent", ["a:one"]));

      const live = await ledger.findLivePresence({ staleAfterMs: 60_000 });

      expect(live.map((row) => row.processId)).toEqual(["recent"]);
    });
  });

  describe("when declared steps are registered", () => {
    const declared = (id: string, owner: string, description: string) => ({
      id,
      kind: "data" as const,
      mode: "background" as const,
      owner,
      description,
    });

    /** @scenario "Registering declared steps records them pending with owner and description" */
    it("records each new step pending with its owner and description", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();

      await ledger.registerDeclaredSteps({
        steps: [
          declared("trace:fold-backfill", "trace", "Backfill the trace fold"),
          declared("usage:meter-rebuild", "usage", "Rebuild the usage meter"),
        ],
      });

      expect(await ledger.findSteps()).toEqual([
        expect.objectContaining({
          id: "trace:fold-backfill",
          status: "pending",
          inferred: false,
          owner: "trace",
          description: "Backfill the trace fold",
        }),
        expect.objectContaining({
          id: "usage:meter-rebuild",
          status: "pending",
          owner: "usage",
        }),
      ]);
    });

    /** @scenario "Registering declared steps never overwrites a done step" */
    it("keeps a done step done and refreshes only its owner and description", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();
      await ledger.registerDeclaredSteps({ steps: [declared("trace:fold", "trace", "Old text")] });
      await scratch.postgres.query(
        `UPDATE "_langwatch_upgrade_step" SET "status" = 'done', "attempt" = 2 WHERE "id" = 'trace:fold'`,
      );

      const registered = await ledger.registerDeclaredSteps({
        steps: [declared("trace:fold", "trace", "New text")],
      });

      expect(registered).toEqual([
        expect.objectContaining({ status: "done", attempt: 2, description: "New text" }),
      ]);
    });
  });

  describe("when a run starts with a floor", () => {
    /** @scenario "A run records the floor it applied with" */
    it("carries the floor on the run it was started with", async () => {
      const ledger = ledgerOf(scratch);
      await ledger.createTables();

      await ledger.startRun({ kind: "upgrade", floor: "3.20.1" });

      expect(await ledger.findRuns()).toEqual([
        expect.objectContaining({ kind: "upgrade", floor: "3.20.1" }),
      ]);
    });
  });
});
