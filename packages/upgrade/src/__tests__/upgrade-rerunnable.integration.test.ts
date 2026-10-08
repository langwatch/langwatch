/**
 * @vitest-environment node
 * @see specs/upgrade/rerunnable-migrations.feature
 * Needs LANGWATCH_TEST_DATABASE_URL; real prisma (deploy and resolve), one scratch database each.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";
import type { SchemaTargetReport, UpgradeSchemaApplier } from "../runner/schema-applier.ts";
import { createUpgradeRunner, type UpgradeRunnerOptions } from "../runner/upgrade-runner.ts";
import { applyRelease } from "../stepping/apply-release.ts";
import { RERUNNABLE_PRISMA_FROM } from "../stepping/rerunnable-migrations.ts";
import { resolveRolledBack } from "../stepping/resolve-migration.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const ENVIRONMENT = { PATH: process.env.PATH, HOME: process.env.HOME };
const BASE = "20260101000000_create_alpha";
/** Re-runnable: the first statement survives a cancel and is a no-op on the second run. */
const NOTE_SQL = `CREATE TABLE IF NOT EXISTS "AlphaNote" ("id" TEXT PRIMARY KEY);
ALTER TABLE "Alpha" ADD COLUMN IF NOT EXISTS "note" TEXT;`;
const NEWER = "29990101000000_alpha_note";
const OLDER = "20260102000000_alpha_note";
const FLOOR = { release: "3.20.1", namedAt: "2026-10-06" };

type Line = { level: "info" | "warn"; message: string; fields: Record<string, unknown> };

let sequence = 0;
let scratch: { name: string; dir: string; url: string; postgres: Pool; admin: Pool };

beforeEach(async () => {
  const name = `upgrade_rerun_${Date.now().toString(36)}_${sequence++}`;
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(DB_URL ?? "");
  url.pathname = `/${name}`;
  const dir = await mkdtemp(join(tmpdir(), "upgrade-rerun-"));
  const postgres = new Pool({ connectionString: url.toString(), max: 4 });
  scratch = { name, dir, url: url.toString(), postgres, admin };
});

afterEach(async () => {
  const { name, admin, postgres, dir } = scratch;
  await postgres.end();
  for (let attempt = 0; attempt < 50; attempt++) {
    const open = await admin.query<{ count: string }>(
      "SELECT count(*) AS count FROM pg_stat_activity WHERE datname = $1",
      [name],
    );
    if (open.rows[0]?.count === "0") break;
    await sleep(100);
  }
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  await rm(dir, { recursive: true, force: true });
});

const step = (id: string): ManifestStep => ({
  id,
  kind: "postgres-schema",
  mode: "blocking",
  owner: null,
  description: `step ${id}`,
});

function manifests({ next }: { next: string }): ReleaseManifest[] {
  return [
    {
      release: "3.20.1",
      previous: null,
      cutAt: "2026-10-01T09:00:00Z",
      steps: [step(`prisma:${BASE}`)],
    },
    {
      release: "3.21.0",
      previous: "3.20.1",
      cutAt: "2026-10-02T09:00:00Z",
      steps: [step(`prisma:${next}`)],
    },
  ];
}

async function writeFolder({ name, sql }: { name: string; sql: string }): Promise<string> {
  const folder = join(scratch.dir, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "migration.sql"), `${sql}\n`);
  return folder;
}

/** The real applier over the scratch folders; records what each attempt left behind. */
async function realApplier({ next }: { next: string }) {
  const folders = {
    "3.20.1": [
      await writeFolder({ name: BASE, sql: 'CREATE TABLE "Alpha" ("id" TEXT PRIMARY KEY);' }),
    ],
    "3.21.0": [await writeFolder({ name: next, sql: NOTE_SQL })],
  };
  const upTo = (release: string | null) =>
    release === "3.20.1" ? folders["3.20.1"] : [...folders["3.20.1"], ...folders["3.21.0"]];
  const attempts: { noteTable: boolean; failed: string[] }[] = [];
  const resolves: string[] = [];
  const applier: UpgradeSchemaApplier = {
    async apply({ release, lockTimeoutMs, signal }) {
      const url = new URL(scratch.url);
      url.searchParams.set("options", `-c lock_timeout=${lockTimeoutMs}`);
      const report = await applyRelease({
        release: release ?? "3.21.0",
        prismaFolders: upTo(release),
        gooseUpTo: null,
        postgresUrl: url.toString(),
        clickhouseTargets: [],
        environment: ENVIRONMENT,
        signal,
      });
      attempts.push(await leftBehind());
      const postgres = report.targets[0];
      const error = postgres?.status === "failed" ? postgres.message : null;
      const ok = postgres?.status === "applied";
      return [{ engine: "postgres", target: "postgres", ok, error }] satisfies SchemaTargetReport[];
    },
    async resolveRolledBack({ migration, signal }) {
      resolves.push(migration);
      const report = await resolveRolledBack({
        migration,
        prismaFolders: upTo(null),
        postgresUrl: scratch.url,
        environment: ENVIRONMENT,
        signal,
      });
      return report.ok ? { ok: true, error: null } : { ok: false, error: report.message };
    },
  };
  return { applier, attempts, resolves };
}

async function leftBehind(): Promise<{ noteTable: boolean; failed: string[] }> {
  const note = await scratch.postgres.query<{ exists: boolean }>(
    `SELECT to_regclass('"AlphaNote"') IS NOT NULL AS exists`,
  );
  return { noteTable: note.rows[0]!.exists, failed: await failedRows() };
}

async function failedRows(): Promise<string[]> {
  const { rows } = await scratch.postgres.query<{ name: string }>(
    `SELECT migration_name AS name FROM _prisma_migrations
     WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY 1`,
  );
  return rows.map((row) => row.name);
}

async function rowsOf(migration: string) {
  const { rows } = await scratch.postgres.query<{ finished: boolean; rolledBack: boolean }>(
    `SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack"
     FROM _prisma_migrations WHERE migration_name = $1 ORDER BY started_at`,
    [migration],
  );
  return rows;
}

function runnerFor({
  release,
  next,
  applier,
  lines = [],
  ...overrides
}: {
  release: string;
  next: string;
  applier: UpgradeSchemaApplier;
  lines?: Line[];
} & Partial<UpgradeRunnerOptions>) {
  const all = manifests({ next });
  const shipped = all.filter((each) => each.release <= release).flatMap((each) => each.steps);
  return createUpgradeRunner({
    postgres: scratch.postgres,
    image: { release, steps: shipped },
    releases: { manifests: all, floor: FLOOR },
    applier,
    identity: { image: release, host: "pod-a" },
    log: {
      info: (message, fields = {}) => void lines.push({ level: "info", message, fields }),
      warn: (message, fields = {}) => void lines.push({ level: "warn", message, fields }),
    },
    lease: { ttlMs: 60_000, heartbeatMs: 10_000, waitMs: 30_000, pollMs: 100 },
    lockTimeoutMs: 300,
    retry: { attempts: 3, backoffMs: 100 },
    ...overrides,
  });
}

const run = (runner: ReturnType<typeof createUpgradeRunner>) =>
  runner.run({ signal: new AbortController().signal });

/** Brings the scratch database to the floor, then holds an exclusive lock on "Alpha". */
async function atFloorWithLockedAlpha({ next }: { next: string }) {
  const floor = await realApplier({ next });
  const outcome = await run(runnerFor({ release: "3.20.1", next, applier: floor.applier }));
  expect(outcome, outcome.message).toMatchObject({ code: "done" });
  const holder: PoolClient = await scratch.postgres.connect();
  await holder.query("BEGIN");
  await holder.query('LOCK TABLE "Alpha" IN ACCESS EXCLUSIVE MODE');
  let released: Promise<unknown> | null = null;
  const release = () => {
    released ??= holder.query("COMMIT").finally(() => holder.release());
    return released;
  };
  return { release };
}

const statusOf = async (id: string) =>
  (await UpgradeLedgerRepository.create({ postgres: scratch.postgres }).findSteps()).find(
    (each) => each.id === id,
  )?.status;

describe.skipIf(!DB_URL)(
  "re-runnable Prisma migrations, resolved and retried by the upgrade",
  () => {
    it("names test migrations either side of the marker", () => {
      expect(NEWER > RERUNNABLE_PRISMA_FROM && OLDER <= RERUNNABLE_PRISMA_FROM).toBe(true);
    });

    /** @scenario "A re-runnable migration cancelled by lock_timeout mid-way is resolved and completes" */
    it("marks it rolled back, retries after the backoff and completes", async () => {
      const lock = await atFloorWithLockedAlpha({ next: NEWER });
      const { applier, attempts, resolves } = await realApplier({ next: NEWER });
      const lines: Line[] = [];
      const log = {
        info: (message: string, fields: Record<string, unknown> = {}) =>
          void lines.push({ level: "info", message, fields }),
        warn: (message: string, fields: Record<string, unknown> = {}) => {
          lines.push({ level: "warn", message, fields });
          if (message.includes("re-runnable")) void lock.release();
        },
      };
      const outcome = await run(runnerFor({ release: "3.21.0", next: NEWER, applier, log }));
      await lock.release();

      expect(outcome).toMatchObject({ exitCode: 0, code: "done" });
      expect(attempts[0]).toEqual({ noteTable: true, failed: [NEWER] });
      expect(attempts.at(-1)).toEqual({ noteTable: true, failed: [] });
      expect(resolves).toEqual([NEWER]);
      const retried = lines.find(
        (line) => line.fields.phase === "postgres-schema" && line.level === "warn",
      );
      expect(retried?.message).toMatch(
        new RegExp(
          `^Prisma migration ${NEWER} failed on attempt 1 of 3 and is re-runnable: marked it rolled back \\(prisma migrate resolve --rolled-back ${NEWER}\\)`,
        ),
      );
      expect(retried?.fields).toMatchObject({ migration: NEWER, attempt: 1, waitMs: 100 });
      expect(lines.map((line) => line.message)).toContain(
        `Prisma migration ${NEWER} applied on attempt 2 after it was marked rolled back`,
      );
      expect(await rowsOf(NEWER)).toEqual([
        { finished: false, rolledBack: true },
        { finished: true, rolledBack: false },
      ]);
      expect(await statusOf(`prisma:${NEWER}`)).toBe("done");
    });

    /** @scenario "A migration at or below the marker still stops by name" */
    it("stops after one attempt naming the resolve command, and leaves the row failed", async () => {
      const lock = await atFloorWithLockedAlpha({ next: OLDER });
      const { applier, attempts, resolves } = await realApplier({ next: OLDER });
      const outcome = await run(runnerFor({ release: "3.21.0", next: OLDER, applier }));
      await lock.release();

      expect(outcome).toMatchObject({
        exitCode: 1,
        code: "failed_prisma_migration",
        detail: { migrations: [OLDER], command: `prisma migrate resolve --rolled-back ${OLDER}` },
      });
      expect(attempts).toHaveLength(1);
      expect(resolves).toEqual([]);
      expect(await rowsOf(OLDER)).toEqual([{ finished: false, rolledBack: false }]);
    });

    /** @scenario "A re-runnable migration still failing after the last attempt names what to fix" */
    it("retries up to the last attempt, then names the migration and that the next run resolves it", async () => {
      const lock = await atFloorWithLockedAlpha({ next: NEWER });
      const { applier, attempts, resolves } = await realApplier({ next: NEWER });
      const lines: Line[] = [];
      const outcome = await run(runnerFor({ release: "3.21.0", next: NEWER, applier, lines }));
      await lock.release();

      expect(outcome).toMatchObject({
        exitCode: 1,
        code: "rerunnable_migration_failed",
        detail: { migrations: [NEWER], attempts: 3 },
      });
      expect(outcome.message).toContain("no prisma migrate resolve is needed");
      expect(outcome.message).toContain("lock timeout");
      expect(attempts).toHaveLength(3);
      expect(resolves).toEqual([NEWER, NEWER]);
      const retries = lines.filter((line) => line.fields.migration === NEWER);
      expect(retries.map((line) => [line.fields.attempt, line.fields.waitMs])).toEqual([
        [1, 100],
        [2, 200],
      ]);
      expect(await failedRows()).toEqual([NEWER]);
    });

    /** @scenario "A failed re-runnable migration left by an earlier run is resolved before the schema is applied" */
    it("resolves the earlier run's failed row at preflight, logs it by name and completes", async () => {
      const lock = await atFloorWithLockedAlpha({ next: NEWER });
      const first = await realApplier({ next: NEWER });
      const once = { attempts: 1, backoffMs: 1 };
      const failed = await run(
        runnerFor({ release: "3.21.0", next: NEWER, applier: first.applier, retry: once }),
      );
      expect(failed.code).toBe("rerunnable_migration_failed");
      await lock.release();

      const { applier, resolves } = await realApplier({ next: NEWER });
      const lines: Line[] = [];
      const outcome = await run(runnerFor({ release: "3.21.0", next: NEWER, applier, lines }));

      expect(outcome).toMatchObject({ exitCode: 0, code: "done" });
      expect(resolves).toEqual([NEWER]);
      const preflight = lines.find(
        (line) => line.fields.phase === "preflight" && line.fields.migration,
      );
      expect(preflight?.message).toMatch(
        new RegExp(
          `^Prisma migration ${NEWER} failed in an earlier run and is re-runnable: marked it rolled back`,
        ),
      );
      const runs = await UpgradeLedgerRepository.create({ postgres: scratch.postgres }).findRuns();
      expect(runs.at(-1)?.report).toMatchObject({ resolved: [{ migration: NEWER, attempt: 0 }] });
      expect(await statusOf(`prisma:${NEWER}`)).toBe("done");
    });

    describe("when the runner may not resolve the failed row itself", () => {
      const failedRow = (migration: string) =>
        scratch.postgres.query(
          `INSERT INTO _prisma_migrations (id, checksum, migration_name, logs)
         VALUES (gen_random_uuid()::text, 'x', $1, 'cancelled')`,
          [migration],
        );

      /** @scenario "A failed re-runnable migration the image does not ship stops by name" */
      it("stops before the applier runs when the image does not ship the migration", async () => {
        const floor = await realApplier({ next: NEWER });
        await run(runnerFor({ release: "3.20.1", next: NEWER, applier: floor.applier }));
        const ghost = "29990202000000_ghost";
        await failedRow(ghost);
        const { applier, attempts, resolves } = await realApplier({ next: NEWER });
        const outcome = await run(runnerFor({ release: "3.21.0", next: NEWER, applier }));
        expect(outcome).toMatchObject({
          code: "failed_prisma_migration",
          detail: { command: `prisma migrate resolve --rolled-back ${ghost}` },
        });
        expect(outcome.message).toContain("This image does not ship it");
        expect([attempts, resolves]).toEqual([[], []]);
      });

      /** @scenario "An applier that cannot resolve keeps the conservative behaviour" */
      it("stops naming the resolve command when the applier cannot resolve", async () => {
        const floor = await realApplier({ next: NEWER });
        await run(runnerFor({ release: "3.20.1", next: NEWER, applier: floor.applier }));
        await failedRow(NEWER);
        const { applier, attempts } = await realApplier({ next: NEWER });
        const outcome = await run(
          runnerFor({
            release: "3.21.0",
            next: NEWER,
            applier: { apply: (args) => applier.apply(args) },
          }),
        );
        expect(outcome).toMatchObject({
          code: "failed_prisma_migration",
          detail: { command: `prisma migrate resolve --rolled-back ${NEWER}` },
        });
        expect(attempts).toEqual([]);
      });

      /** @scenario "A resolve that fails stops the run naming the resolve command and the error" */
      it("stops naming the resolve error and the command when the resolve fails", async () => {
        const floor = await realApplier({ next: NEWER });
        await run(runnerFor({ release: "3.20.1", next: NEWER, applier: floor.applier }));
        await failedRow(NEWER);
        const { applier, attempts } = await realApplier({ next: NEWER });
        const refusing: UpgradeSchemaApplier = {
          apply: (args) => applier.apply(args),
          resolveRolledBack: async () => {
            await sleep(1);
            return { ok: false, error: "Error: P1001 database unreachable" };
          },
        };
        const outcome = await run(runnerFor({ release: "3.21.0", next: NEWER, applier: refusing }));
        expect(outcome).toMatchObject({
          code: "failed_prisma_migration",
          detail: { command: `prisma migrate resolve --rolled-back ${NEWER}` },
        });
        expect(outcome.message).toContain("Marking it rolled back failed: Error: P1001");
        expect(attempts).toEqual([]);
        expect(await failedRows()).toEqual([NEWER]);
      });
    });
  },
);
