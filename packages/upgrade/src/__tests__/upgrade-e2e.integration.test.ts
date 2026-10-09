/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-e2e.feature and specs/upgrade/upgrade-logging.feature
 * Needs LANGWATCH_TEST_DATABASE_URL and _CLICKHOUSE_URL; real prisma and goose, own databases.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { type ClickHouseClient, ClickHouseError, createClient } from "@clickhouse/client";
import { storesOwner } from "@langwatch/process-stores/config";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { servingUpgradeGate } from "../gate/serving-upgrade-gate.ts";
import { createUpgradeGate } from "../gate/upgrade-gate.service.ts";
import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";
import type { UpgradeClickHouse } from "../ports.ts";
import { UpgradeRunnerRepository } from "../runner/runner-ledger.repository.ts";
import {
  gooseAppliedStepIds,
  type SchemaTargetReport,
  type UpgradeSchemaApplier,
} from "../runner/schema-applier.ts";
import { createUpgradeRunner, type UpgradeRunnerOptions } from "../runner/upgrade-runner.ts";
import { createServingRoster } from "../serving-roster/serving-roster.service.ts";
import { defineMigrationStep, type MigrationStep } from "../step/migration-step.ts";
import { applyRelease, type ReleaseApplyReport } from "../stepping/apply-release.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const CH_URL = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
const REPO_GOOSE = fileURLToPath(new URL("../../../../.bin/goose/goose", import.meta.url));
const GOOSE = existsSync(REPO_GOOSE) ? REPO_GOOSE : "goose";
const ENVIRONMENT = { PATH: process.env.PATH, HOME: process.env.HOME };
const PASSWORD = "e2e-pw-7731";
const HOSTILE = `x'); DROP TABLE "_langwatch_upgrade_run"; --`;

type Release = { release: string; prisma: Record<string, string>; goose: Record<string, string> };

const FIXTURE: Release[] = [
  {
    release: "3.20.1",
    prisma: { "20260101000000_create_alpha": 'CREATE TABLE "Alpha" ("id" TEXT PRIMARY KEY);' },
    goose: {
      "00001": "CREATE TABLE IF NOT EXISTS alpha_events (id String) ENGINE = MergeTree ORDER BY id",
    },
  },
  {
    release: "3.21.0",
    prisma: { "20260102000000_add_alpha_note": 'ALTER TABLE "Alpha" ADD COLUMN "note" TEXT;' },
    goose: { "00002": "ALTER TABLE alpha_events ADD COLUMN IF NOT EXISTS note String DEFAULT ''" },
  },
];

const step = (
  id: string,
  kind: ManifestStep["kind"],
  mode: ManifestStep["mode"],
  description = `step ${id}`,
): ManifestStep => ({
  id,
  kind,
  mode,
  owner: null,
  description,
});

function manifests({ hostile = false }: { hostile?: boolean } = {}): ReleaseManifest[] {
  const schemaSteps = (release: Release) => [
    ...Object.keys(release.prisma).map((name) =>
      step(`prisma:${name}`, "postgres-schema", "blocking"),
    ),
    ...Object.keys(release.goose).map((version) =>
      step(`clickhouse:${version}`, "clickhouse-schema", "blocking"),
    ),
  ];
  const [floor, next] = FIXTURE as [Release, Release];
  return [
    {
      release: floor.release,
      previous: null,
      cutAt: "2026-10-01T09:00:00+02:00",
      steps: schemaSteps(floor),
    },
    {
      release: next.release,
      previous: floor.release,
      cutAt: "2026-10-02T09:00:00+02:00",
      steps: [
        ...schemaSteps(next),
        step("dataset:copy-notes", "data", "blocking", hostile ? HOSTILE : "copies the notes"),
        ...(hostile ? [step(`dataset:${HOSTILE}`, "data", "background", HOSTILE)] : []),
      ],
    },
  ];
}
const FLOOR = { release: "3.20.1", namedAt: "2026-10-06" };

type Line = { level: "info" | "warn"; message: string; fields: Record<string, unknown> };

let sequence = 0;
let scratch: {
  name: string;
  dir: string;
  postgresUrl: string;
  postgres: Pool;
  admin: Pool;
  clickhouse: ClickHouseClient;
  root: ClickHouseClient;
};

beforeEach(async () => {
  const name = `upgrade_e2e_${Date.now().toString(36)}_${sequence++}`;
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(DB_URL ?? "");
  url.pathname = `/${name}`;
  url.password = PASSWORD;
  const root = createClient({ url: CH_URL });
  await root.command({ query: `CREATE DATABASE ${name}` });
  const dir = await mkdtemp(join(tmpdir(), "upgrade-e2e-"));
  await mkdir(join(dir, "goose"));
  for (const release of FIXTURE) {
    for (const [folder, sql] of Object.entries(release.prisma)) {
      await mkdir(join(dir, "prisma", folder), { recursive: true });
      await writeFile(join(dir, "prisma", folder, "migration.sql"), `${sql}\n`);
    }
    for (const [version, sql] of Object.entries(release.goose)) {
      const body = `-- +goose Up\n-- +goose StatementBegin\n${sql}\n-- +goose StatementEnd\n`;
      await writeFile(join(dir, "goose", `${version}_e2e.sql`), body);
    }
  }
  scratch = {
    name,
    dir,
    postgresUrl: url.toString(),
    postgres: new Pool({ connectionString: url.toString(), max: 4 }),
    admin,
    clickhouse: createClient({ url: CH_URL, database: name }),
    root,
  };
});

afterEach(async () => {
  const { name, admin, postgres, clickhouse, root, dir } = scratch;
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
  await clickhouse.close();
  await root.command({ query: `DROP DATABASE IF EXISTS ${name}` });
  await root.close();
  await rm(dir, { recursive: true, force: true });
});

/** The tables one Postgres schema of the scratch database holds, by name. */
async function tablesIn(schema: string): Promise<string[]> {
  const { rows } = await scratch.postgres.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`,
    [schema],
  );
  return rows.map((row) => row.name);
}

function reader(client: ClickHouseClient): UpgradeClickHouse {
  return {
    async queryRows<Row extends object>(sql: string): Promise<Row[]> {
      try {
        return await (await client.query({ query: sql, format: "JSONEachRow" })).json<Row>();
      } catch (error) {
        if (error instanceof ClickHouseError && error.type === "UNKNOWN_TABLE") return [];
        throw error;
      }
    },
  };
}

/** The real applier: `prisma migrate deploy` and goose `up-to` over the fixture's folders. */
function realApplier({ image }: { image: string }): UpgradeSchemaApplier {
  const upTo = (release: string | null) =>
    FIXTURE.filter((each) => each.release <= (release ?? image));
  const target = () => {
    const dsn = new URL(CH_URL ?? "");
    dsn.pathname = "/";
    dsn.searchParams.set("database", scratch.name);
    const table = `${scratch.name}.goose_db_version`;
    return {
      name: "shared",
      dsn: dsn.toString(),
      table,
      migrationsDir: join(scratch.dir, "goose"),
    };
  };
  const apply = (releases: Release[], withClickHouse: boolean, signal: AbortSignal) =>
    applyRelease({
      release: releases.at(-1)?.release ?? "none",
      prismaFolders: releases.flatMap((each) =>
        Object.keys(each.prisma).map((folder) => join(scratch.dir, "prisma", folder)),
      ),
      gooseUpTo: withClickHouse ? Number(Object.keys(releases.at(-1)?.goose ?? {}).at(-1)) : null,
      postgresUrl: scratch.postgresUrl,
      clickhouseTargets: withClickHouse ? [target()] : [],
      environment: ENVIRONMENT,
      tools: { goose: GOOSE },
      signal,
    });
  const postgresOf = (report: ReleaseApplyReport): SchemaTargetReport => {
    const first = report.targets[0];
    const ok = first?.status === "applied";
    let error: string | null = ok ? null : "no report";
    if (first?.status === "failed") error = first.message;
    if (first?.status === "skipped") error = first.reason;
    return { engine: "postgres", target: "postgres", ok, error };
  };
  return {
    async apply({ release, signal }) {
      const report = await apply(upTo(release), true, signal);
      const clickhouse = report.targets.find((each) => each.target === "shared");
      const failed = clickhouse?.status === "failed" ? clickhouse.message : null;
      const applied = await gooseAppliedStepIds({ clickhouse: reader(scratch.clickhouse) });
      return [
        postgresOf(report),
        { engine: "clickhouse", target: "shared", ok: failed === null, error: failed, applied },
      ];
    },
  };
}

function runnerFor({
  release,
  host = "pod-a",
  lines = [],
  hostile = false,
  ...overrides
}: {
  release: string;
  host?: string;
  lines?: Line[];
  hostile?: boolean;
} & Partial<UpgradeRunnerOptions>) {
  const all = manifests({ hostile });
  const shipped = all.filter((each) => each.release <= release).flatMap((each) => each.steps);
  return createUpgradeRunner({
    postgres: scratch.postgres,
    clickhouse: reader(scratch.clickhouse),
    image: { release, steps: shipped },
    releases: { manifests: all, floor: FLOOR },
    applier: realApplier({ image: release }),
    identity: { image: release, host },
    log: {
      info: (message, fields = {}) => void lines.push({ level: "info", message, fields }),
      warn: (message, fields = {}) => void lines.push({ level: "warn", message, fields }),
    },
    lease: { ttlMs: 60_000, heartbeatMs: 10_000, waitMs: 90_000, pollMs: 100 },
    retry: { attempts: 1, backoffMs: 1 },
    ...overrides,
  });
}

const run = (
  runner: ReturnType<typeof createUpgradeRunner>,
  signal = new AbortController().signal,
) => runner.run({ signal });
const ledger = () => UpgradeLedgerRepository.create({ postgres: scratch.postgres });
const statusOf = async (id: string) =>
  (await ledger().findSteps()).find((s) => s.id === id)?.status;
const copyNotes = (run: MigrationStep["run"], description = "copies the notes"): MigrationStep =>
  defineMigrationStep({
    id: "dataset:copy-notes",
    kind: "data",
    mode: "blocking",
    description,
    run,
  });
const ALL_SCHEMA = [
  "prisma:20260101000000_create_alpha",
  "prisma:20260102000000_add_alpha_note",
  "clickhouse:00001",
  "clickhouse:00002",
];

async function columns(table: string): Promise<string[]> {
  const result = await scratch.postgres.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name",
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function clickhouseColumns(): Promise<string[]> {
  const rows = await reader(scratch.clickhouse).queryRows<{ name: string }>(
    "SELECT name FROM system.columns WHERE database = currentDatabase() AND table = 'alpha_events' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

describe.skipIf(!DB_URL || !CH_URL)("the upgrade, end to end over live stores", () => {
  describe("when the databases are empty", () => {
    /** @scenario "A fresh install from an empty database applies every migration, then a re-run is a no-op" */
    it("applies every migration, records it done, and a second run changes nothing", async () => {
      const outcome = await run(
        runnerFor({ release: "3.21.0", codeSteps: [copyNotes(async () => ({}))] }),
      );
      expect(outcome).toMatchObject({ code: "done", exitCode: 0 });
      expect(await columns("Alpha")).toEqual(["id", "note"]);
      expect(await clickhouseColumns()).toEqual(["id", "note"]);
      for (const id of ALL_SCHEMA) expect(await statusOf(id), id).toBe("done");
      expect(await statusOf("dataset:copy-notes")).toBe("not-needed");

      const before = await ledger().findSteps();
      const again = runnerFor({ release: "3.21.0" });
      const second = await run(again);
      expect(second).toMatchObject({ code: "done", detail: { applied: [] } });
      expect(await ledger().findSteps()).toEqual(before);
      expect(await tablesIn("public")).toEqual(["Alpha", "_prisma_migrations"]);
      expect(await tablesIn("public_upgrade_ledger")).toEqual([
        "_langwatch_serving_roster",
        "_langwatch_upgrade_lease",
        "_langwatch_upgrade_run",
        "_langwatch_upgrade_step",
        "_langwatch_upgrade_target",
      ]);
    });

    /** @scenario "A first run announces itself, the number of migrations, and that serving follows" */
    it("narrates the first run from its first line to its last", async () => {
      const lines: Line[] = [];
      await run(runnerFor({ release: "3.21.0", lines, codeSteps: [copyNotes(async () => ({}))] }));
      expect(lines[0]?.message).toMatch(
        /^first run: .*creates its ledger in its own Postgres schema/,
      );
      expect(lines.map((line) => line.message)).toContainEqual(
        expect.stringMatching(
          /^first run: applying 4 schema migrations \(2 Postgres, 2 ClickHouse\).*then the api and worker serve/,
        ),
      );
      expect(lines.at(-1)?.message).toMatch(/^first run finished in \d+ ms/);
      expect(lines.at(-1)?.fields).toMatchObject({
        next: expect.stringContaining("pnpm task upgrade status"),
      });
    });

    /** @scenario "No log line of a full upgrade carries the database password" */
    it("never logs the password the database URL carries", async () => {
      const lines: Line[] = [];
      expect(scratch.postgresUrl).toContain(PASSWORD);
      await run(runnerFor({ release: "3.21.0", lines, codeSteps: [copyNotes(async () => ({}))] }));
      expect(lines.length).toBeGreaterThan(5);
      expect(JSON.stringify(lines)).not.toContain(PASSWORD);
    });
  });

  describe("when the installation is at the LTS floor", () => {
    beforeEach(async () => {
      const installed = await run(runnerFor({ release: "3.20.1" }));
      if (installed.code !== "done")
        throw new Error(`installing 3.20.1 failed: ${installed.message}`);
    });

    /** @scenario "An installation at the LTS floor upgrades to the next release" */
    it("applies the next release on both stores and runs its blocking step once", async () => {
      expect(await columns("Alpha")).toEqual(["id"]);
      let runs = 0;
      const steps = [copyNotes(async () => ({ copied: ++runs }))];
      const outcome = await run(runnerFor({ release: "3.21.0", codeSteps: steps }));
      expect(outcome.code).toBe("done");
      expect(await columns("Alpha")).toEqual(["id", "note"]);
      expect(await clickhouseColumns()).toEqual(["id", "note"]);
      expect(runs).toBe(1);
      expect((await ledger().findSteps()).find((s) => s.id === "dataset:copy-notes")).toMatchObject(
        {
          status: "done",
          report: { copied: 1 },
        },
      );
    });

    /** @scenario "Each phase is logged as it starts and ends, with its elapsed time and the next action" */
    it("logs a start and an end line for every phase, each with the next action", async () => {
      const lines: Line[] = [];
      await run(runnerFor({ release: "3.21.0", lines, codeSteps: [copyNotes(async () => ({}))] }));
      for (const phase of ["preflight", "postgres-schema", "clickhouse-schema", "reconcile"]) {
        const own = lines.filter((line) => line.fields.phase === phase);
        expect(
          own.map((line) => line.message),
          phase,
        ).toEqual([
          expect.stringMatching(/started: waiting on /),
          expect.stringMatching(/succeeded in \d+ ms$/),
        ]);
        expect(own[0]?.fields).toMatchObject({
          waitingOn: expect.any(String),
          elapsedMs: expect.any(Number),
        });
        expect(own[1]?.fields).toMatchObject({ phaseElapsedMs: expect.any(Number) });
        for (const line of own) expect(line.fields.next, phase).toEqual(expect.any(String));
      }
    });

    /** @scenario "A blocking code step is announced and timed" */
    it("announces the step by id and description, then reports it done with its time", async () => {
      const lines: Line[] = [];
      await run(runnerFor({ release: "3.21.0", lines, codeSteps: [copyNotes(async () => ({}))] }));
      const messages = lines.filter((line) => line.fields.step === "dataset:copy-notes");
      expect(messages.map((line) => line.message)).toEqual([
        "blocking step dataset:copy-notes started (from the start): copies the notes",
        expect.stringMatching(/^blocking step dataset:copy-notes done in \d+ ms$/),
      ]);
    });

    /** @scenario "A blocking step interrupted mid-run resumes from its checkpoint" */
    it("hands the second run the checkpoint the interrupted one saved", async () => {
      const interrupt = new AbortController();
      const seen: unknown[] = [];
      const step = copyNotes(async ({ checkpoint, signal }) => {
        seen.push(checkpoint.resumeFrom);
        if (checkpoint.resumeFrom === null) {
          await checkpoint.save({ report: { copied: 2 } });
          interrupt.abort(new Error("the pod was stopped"));
          signal.throwIfAborted();
        }
        return { copied: 5 };
      });
      const first = await run(
        runnerFor({ release: "3.21.0", codeSteps: [step] }),
        interrupt.signal,
      );
      expect(first.exitCode).toBe(1);
      const second = await run(runnerFor({ release: "3.21.0", codeSteps: [step] }));
      expect(second.code).toBe("done");
      expect(seen).toEqual([null, { copied: 2 }]);
      expect(await statusOf("dataset:copy-notes")).toBe("done");
    });

    /** @scenario "Two upgraders at once - one takes the lease, the other waits and reports the holder" */
    /** @scenario "A second upgrader waiting for the lease says who holds it, how long it has waited and what to do" */
    it("lets one upgrader apply while the other waits, names the holder, then finds nothing", async () => {
      const linesA: Line[] = [];
      const linesB: Line[] = [];
      const slow = copyNotes(async () => {
        await sleep(1_500);
        return {};
      });
      const outcomes = await Promise.all([
        run(runnerFor({ release: "3.21.0", host: "pod-a", lines: linesA, codeSteps: [slow] })),
        sleep(300).then(() =>
          run(runnerFor({ release: "3.21.0", host: "pod-b", lines: linesB, codeSteps: [slow] })),
        ),
      ]);
      expect(outcomes.map((outcome) => outcome.code)).toEqual(["done", "done"]);
      expect(
        outcomes
          .map((outcome) => (outcome.detail.applied as string[]).length)
          .toSorted((a, b) => a - b),
      ).toEqual([0, 3]);
      const waiting = linesB.find((line) => line.fields.phase === "lease");
      expect(waiting?.message).toMatch(
        /^waiting for the upgrade lease held by pod-a:\S+ on pod-a \(3\.21\.0\)/,
      );
      expect(waiting?.fields).toMatchObject({
        waitedMs: expect.any(Number),
        waitMs: 90_000,
        next: expect.any(String),
      });
    });

    /** @scenario "A step that throws leaves the ledger consistent and the next run names the failing step" */
    it("records the failure consistently and names the step on the next run", async () => {
      const broken = copyNotes(async () => {
        throw new Error('relation "Ghost" does not exist');
      });
      const first = await run(runnerFor({ release: "3.21.0", codeSteps: [broken] }));
      expect(first).toMatchObject({ code: "step_failed", detail: { step: "dataset:copy-notes" } });
      const steps = await ledger().findSteps();
      expect(steps.filter((each) => each.status === "running")).toEqual([]);
      expect(steps.find((each) => each.id === "dataset:copy-notes")).toMatchObject({
        status: "failed",
        lastError: expect.stringContaining("Ghost"),
      });
      expect((await ledger().findRuns()).at(-1)).toMatchObject({ outcome: "failed" });
      const runner = UpgradeRunnerRepository.create({ postgres: scratch.postgres });
      expect(await runner.findLease({ name: "upgrade" })).toBeNull();

      const second = await run(runnerFor({ release: "3.21.0", codeSteps: [broken] }));
      expect(second).toMatchObject({ code: "step_failed", detail: { step: "dataset:copy-notes" } });
      expect(second.message).toContain("dataset:copy-notes");
    });

    /** @scenario "Hostile text in a step id or description is stored verbatim and never executed" */
    it("stores the text as data and leaves every ledger table in place", async () => {
      const steps = [copyNotes(async () => ({}), HOSTILE)];
      const outcome = await run(runnerFor({ release: "3.21.0", hostile: true, codeSteps: steps }));
      expect(outcome.code).toBe("done");
      const recorded = await ledger().findSteps();
      expect(recorded.find((each) => each.id === `dataset:${HOSTILE}`)).toMatchObject({
        description: HOSTILE,
      });
      expect(recorded.find((each) => each.id === "dataset:copy-notes")).toMatchObject({
        description: HOSTILE,
      });
      const tables = await scratch.postgres.query<{ present: string | null }>(
        "SELECT to_regclass('public_upgrade_ledger._langwatch_upgrade_run')::text AS present",
      );
      expect(tables.rows[0]?.present).toBe("public_upgrade_ledger._langwatch_upgrade_run");
    });

    /** @scenario "A lapsed roster entry stops serving and the next good write serves again" */
    it("stops serving once its roster writes fail past the stale bound, and serves after a good one", async () => {
      const repository = ledger();
      const roster = createServingRoster({
        ledger: repository,
        staleAfterMs: 600,
        refreshEveryMs: 100,
      });
      const gate = createUpgradeGate({
        role: "worker",
        processId: "pod-c:1:worker",
        image: { release: "3.20.1", blockingSteps: [], name: "3.20.1", declaredSteps: [] },
        ledger: { findSteps: () => repository.findSteps(), findRuns: () => repository.findRuns() },
        roster,
        schemaIsEmpty: async () => false,
      });
      expect(await gate.admit()).toMatchObject({ admitted: true });
      expect(gate.serving()).toBe(true);
      await scratch.postgres.query(
        'ALTER TABLE "public_upgrade_ledger"."_langwatch_serving_roster" RENAME TO "_roster_away"',
      );
      await sleep(1_200);
      expect(gate.serving()).toBe(false);
      await scratch.postgres.query(
        'ALTER TABLE "public_upgrade_ledger"."_roster_away" RENAME TO "_langwatch_serving_roster"',
      );
      await sleep(400);
      expect(gate.serving()).toBe(true);
      await gate.release();
    });

    /** @scenario "A serving process with no ClickHouse refuses by name" */
    it("refuses an api on a live installation when no ClickHouse is configured", async () => {
      const declared = Object.values(storesOwner.secrets);
      const environment = { DATABASE_URL: scratch.postgresUrl };
      const secrets = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
      const gate = await servingUpgradeGate({
        secrets: secrets.scopeTo("upgrade-e2e", declared),
        role: "api",
      });
      const verdict = await gate.admit();
      expect(verdict).toMatchObject({ admitted: false, outcome: "no-clickhouse" });
      expect(verdict.admitted ? "" : verdict.refusal).toContain("CLICKHOUSE_URL");
    });
  });
});
