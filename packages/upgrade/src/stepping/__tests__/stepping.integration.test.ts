/**
 * @vitest-environment node
 * @see specs/upgrade/stepping.feature
 * Requires LANGWATCH_TEST_DATABASE_URL and LANGWATCH_TEST_CLICKHOUSE_URL. Every test creates its
 * own Postgres and ClickHouse databases and drops them after, so no shared schema is touched.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyRelease,
  type ClickHouseStepTarget,
  type ReleaseApplyReport,
} from "../apply-release.ts";
import { runTool } from "../tool-run.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const CH_URL = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
const REPO_GOOSE = fileURLToPath(new URL("../../../../../.bin/goose/goose", import.meta.url));
const GOOSE = existsSync(REPO_GOOSE) ? REPO_GOOSE : "goose";
const ENVIRONMENT = { PATH: process.env.PATH, HOME: process.env.HOME };

const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PRISMA_CLI = join(PACKAGE_ROOT, "node_modules/.bin/prisma");
const resolves = (specifier: string) => {
  try {
    createRequire(import.meta.url).resolve(specifier);
    return true;
  } catch {
    return false;
  }
};
/** The client proof runs once `@prisma/client` and its pg adapter are devDependencies here. */
const CLIENT_RESOLVES = resolves("@prisma/client/package.json") && resolves("@prisma/adapter-pg");

let sequence = 0;

interface Scratch {
  name: string;
  dir: string;
  postgresUrl: string;
  postgres: Pool;
  clickhouse: ClickHouseClient;
  target: ClickHouseStepTarget;
  drop(): Promise<void>;
}

async function openScratch(): Promise<Scratch> {
  const name = `stepping_${Date.now().toString(36)}_${sequence++}`;
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(DB_URL ?? "");
  url.pathname = `/${name}`;
  const postgres = new Pool({ connectionString: url.toString(), max: 1 });
  const root = createClient({ url: CH_URL });
  await root.command({ query: `CREATE DATABASE ${name}` });
  const dsn = new URL(CH_URL ?? "");
  dsn.pathname = "/";
  dsn.searchParams.set("database", name);
  const dir = await mkdtemp(join(tmpdir(), "stepping-it-"));
  await mkdir(join(dir, "goose"));
  return {
    name,
    dir,
    postgresUrl: url.toString(),
    postgres,
    clickhouse: root,
    target: {
      name: "clickhouse",
      dsn: dsn.toString(),
      table: `${name}.goose_db_version`,
      migrationsDir: join(dir, "goose"),
    },
    drop: async () => {
      await postgres.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
      await root.command({ query: `DROP DATABASE IF EXISTS ${name}` });
      await root.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe.skipIf(!DB_URL || !CH_URL)("applyRelease against Postgres and ClickHouse", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await openScratch();
  });

  afterEach(async () => {
    await scratch.drop();
  });

  async function prismaFolder(name: string, sql: string): Promise<string> {
    const path = join(scratch.dir, "prisma", name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "migration.sql"), sql);
    return path;
  }

  async function gooseFile(version: string, sql: string): Promise<void> {
    await writeFile(
      join(scratch.dir, "goose", `${version}.sql`),
      `-- +goose Up\n-- +goose StatementBegin\n${sql}\n-- +goose StatementEnd\n`,
    );
  }

  const apply = ({
    prismaFolders,
    gooseUpTo = null,
    targets = [scratch.target],
  }: {
    prismaFolders: readonly string[];
    gooseUpTo?: number | null;
    targets?: readonly ClickHouseStepTarget[];
  }): Promise<ReleaseApplyReport> =>
    applyRelease({
      release: "test",
      prismaFolders,
      gooseUpTo,
      postgresUrl: scratch.postgresUrl,
      clickhouseTargets: targets,
      environment: ENVIRONMENT,
      tools: { goose: GOOSE },
    });

  const postgresOf = (report: ReleaseApplyReport) => report.targets[0];

  async function prismaHistory(): Promise<{ name: string; done: boolean }[]> {
    const result = await scratch.postgres.query<{ name: string; done: boolean }>(
      `SELECT migration_name AS name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS done
         FROM _prisma_migrations ORDER BY migration_name`,
    );
    return result.rows;
  }

  async function gooseVersions(): Promise<number[]> {
    const result = await scratch.clickhouse.query({
      query: `SELECT toUInt32(version_id) AS v FROM ${scratch.name}.goose_db_version WHERE is_applied AND version_id > 0 ORDER BY version_id`,
      format: "JSONEachRow",
    });
    return (await result.json<{ v: number }>()).map((row) => row.v);
  }

  const alpha = () =>
    prismaFolder(
      "20260101000000_create_alpha",
      'CREATE TABLE IF NOT EXISTS "Alpha" ("id" TEXT PRIMARY KEY);',
    );
  const note = () =>
    prismaFolder(
      "20260102000000_add_alpha_note",
      'ALTER TABLE "Alpha" ADD COLUMN IF NOT EXISTS "note" TEXT;',
    );
  const beta = () =>
    prismaFolder(
      "20260103000000_create_beta",
      'CREATE TABLE IF NOT EXISTS "Beta" ("id" TEXT PRIMARY KEY);',
    );

  describe("when three releases are applied in turn", () => {
    /** @scenario "Successive release subsets apply cleanly and record each Prisma migration once" */
    it("applies each release's own folders once and nothing on a repeat", async () => {
      const [a, b, c] = [await alpha(), await note(), await beta()];
      expect(postgresOf(await apply({ prismaFolders: [a] }))).toMatchObject({
        status: "applied",
        applied: ["20260101000000_create_alpha"],
      });
      expect(postgresOf(await apply({ prismaFolders: [a, b] }))).toMatchObject({
        status: "applied",
        applied: ["20260102000000_add_alpha_note"],
      });
      expect(postgresOf(await apply({ prismaFolders: [a, b, c] }))).toMatchObject({
        status: "applied",
        applied: ["20260103000000_create_beta"],
      });
      const history = await prismaHistory();
      expect(history.map((row) => row.name)).toEqual([
        "20260101000000_create_alpha",
        "20260102000000_add_alpha_note",
        "20260103000000_create_beta",
      ]);
      expect(history.every((row) => row.done)).toBe(true);
      expect(postgresOf(await apply({ prismaFolders: [a, b, c] }))).toEqual({
        target: "postgres",
        status: "applied",
        applied: [],
      });
    });
  });

  describe("when the next release adds a folder sorting below an applied one", () => {
    /** @scenario "A folder that sorts below an applied one is applied by the next release (proof)" */
    it("applies the lower folder and records every folder once", async () => {
      const [a, c] = [await alpha(), await beta()];
      await apply({ prismaFolders: [a, c] });
      const report = await apply({ prismaFolders: [a, await note(), c] });
      expect(report.ok).toBe(true);
      expect(postgresOf(report)).toMatchObject({
        status: "applied",
        applied: ["20260102000000_add_alpha_note"],
      });
      const history = await prismaHistory();
      expect(history).toHaveLength(3);
      expect(history.every((row) => row.done)).toBe(true);
    });
  });

  describe("when a release directory lacks an applied folder", () => {
    /** @scenario "A release directory that lacks an applied folder changes nothing (proof)" */
    it("applies nothing and leaves the history whole", async () => {
      const [a, b, c] = [await alpha(), await note(), await beta()];
      await apply({ prismaFolders: [a] });
      await apply({ prismaFolders: [a, b] });
      await apply({ prismaFolders: [a, b, c] });
      expect(postgresOf(await apply({ prismaFolders: [a] }))).toEqual({
        target: "postgres",
        status: "applied",
        applied: [],
      });
      expect(await prismaHistory()).toHaveLength(3);
    });
  });

  describe("when a release's Prisma folder fails", () => {
    /** @scenario "A failed Prisma migration fails the release and skips its ClickHouse targets" */
    it("reports P3018, skips ClickHouse, and the next release reports P3009", async () => {
      const a = await alpha();
      const broken = await prismaFolder("20260102000000_broken", "SELECT 1/0;");
      const report = await apply({ prismaFolders: [a, broken], gooseUpTo: 1 });
      expect(report.ok).toBe(false);
      expect(postgresOf(report)).toMatchObject({ status: "failed", code: "P3018" });
      expect(report.targets[1]).toEqual({
        target: "clickhouse",
        status: "skipped",
        reason: "postgres_failed",
      });
      const next = await apply({ prismaFolders: [a, broken, await beta()] });
      expect(postgresOf(next)).toMatchObject({ status: "failed", code: "P3009" });
    });
  });

  describe("when goose steps up to each release's last version", () => {
    /** @scenario "goose up-to per release, then up, applies every ClickHouse version once" */
    it("applies each release's own versions once and leaves nothing for up", async () => {
      await gooseFile(
        "00001_alpha",
        "CREATE TABLE IF NOT EXISTS alpha (id String) ENGINE = MergeTree ORDER BY id;",
      );
      await gooseFile(
        "00002_alpha_note",
        "ALTER TABLE alpha ADD COLUMN IF NOT EXISTS note String DEFAULT '';",
      );
      await gooseFile(
        "00003_beta",
        "CREATE TABLE IF NOT EXISTS beta (id String) ENGINE = MergeTree ORDER BY id;",
      );
      await gooseFile(
        "00004_gamma",
        "CREATE TABLE IF NOT EXISTS gamma (id String) ENGINE = MergeTree ORDER BY id;",
      );
      const a = await alpha();
      const releases: [number, string[]][] = [
        [1, ["00001"]],
        [3, ["00002", "00003"]],
        [4, ["00004"]],
      ];
      for (const [upTo, versions] of releases) {
        const report = await apply({ prismaFolders: [a], gooseUpTo: upTo });
        expect(report.targets[1]).toEqual({
          target: "clickhouse",
          status: "applied",
          applied: versions,
        });
      }
      expect(await gooseVersions()).toEqual([1, 2, 3, 4]);
      const up = await runTool({
        command: GOOSE,
        args: [
          "-dir",
          scratch.target.migrationsDir,
          "-table",
          scratch.target.table,
          "clickhouse",
          scratch.target.dsn,
          "up",
        ],
        environment: ENVIRONMENT,
      });
      expect(up.exitCode).toBe(0);
      expect(up.output).toContain("no migrations to run");
      expect(await gooseVersions()).toEqual([1, 2, 3, 4]);
    });
  });

  describe("when a release adds a goose version below the applied one", () => {
    /** @scenario "A goose version below the applied one fails its target and names the version (proof)" */
    it("fails the target with goose_missing_migrations naming the version", async () => {
      await gooseFile(
        "00001_alpha",
        "CREATE TABLE IF NOT EXISTS alpha (id String) ENGINE = MergeTree ORDER BY id;",
      );
      await gooseFile(
        "00003_beta",
        "CREATE TABLE IF NOT EXISTS beta (id String) ENGINE = MergeTree ORDER BY id;",
      );
      const a = await alpha();
      await apply({ prismaFolders: [a], gooseUpTo: 3 });
      await gooseFile(
        "00002_gamma",
        "CREATE TABLE IF NOT EXISTS gamma (id String) ENGINE = MergeTree ORDER BY id;",
      );
      const report = await apply({ prismaFolders: [a], gooseUpTo: 3 });
      expect(report.ok).toBe(false);
      expect(report.targets[1]).toMatchObject({
        status: "failed",
        code: "goose_missing_migrations",
      });
      expect(report.targets[1]?.status === "failed" && report.targets[1].message).toContain(
        "version 2",
      );
    });
  });

  describe("when one of two ClickHouse targets cannot be reached", () => {
    /** @scenario "A failed ClickHouse target fails the release while the other targets still apply" */
    it("applies the reachable target and fails the unreachable one", async () => {
      await gooseFile(
        "00001_alpha",
        "CREATE TABLE IF NOT EXISTS alpha (id String) ENGINE = MergeTree ORDER BY id;",
      );
      const unreachable = {
        ...scratch.target,
        name: "unreachable",
        dsn: "http://127.0.0.1:1/?database=nowhere",
      };
      const report = await apply({
        prismaFolders: [await alpha()],
        gooseUpTo: 1,
        targets: [unreachable, scratch.target],
      });
      expect(report.ok).toBe(false);
      expect(report.targets[1]).toMatchObject({ target: "unreachable", status: "failed" });
      expect(report.targets[2]).toEqual({
        target: "clickhouse",
        status: "applied",
        applied: ["00001"],
      });
    });
  });

  describe("when no goose version leads up to the release", () => {
    /** @scenario "A release with no ClickHouse version yet skips goose" */
    it("skips every ClickHouse target", async () => {
      const report = await apply({ prismaFolders: [await alpha()], gooseUpTo: null });
      expect(report.ok).toBe(true);
      expect(report.targets[1]).toEqual({
        target: "clickhouse",
        status: "skipped",
        reason: "no_clickhouse_version",
      });
    });
  });
});

const PROBE = `import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./client/client.ts";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.argv[2] }) });
const probes = {
  defaultSelect: () => prisma.alpha.findMany(),
  narrowSelect: () => prisma.alpha.findMany({ select: { id: true } }),
  createWithDefault: () => prisma.alpha.create({ data: { id: "a" }, select: { id: true } }),
};
const outcomes = {};
for (const [name, probe] of Object.entries(probes)) {
  outcomes[name] = await probe().then(() => "ok", (error) => error.code ?? "unknown");
}
await prisma.$disconnect();
console.log(JSON.stringify(outcomes));
`;

describe.skipIf(!DB_URL || !CLIENT_RESOLVES)("a model client newer than its table", () => {
  /** @scenario "The newest model client cannot read or write a table an older release left behind (proof)" */
  it("fails the default select and a defaulted create with P2022 and passes a narrow select", async () => {
    const name = `stepping_client_${Date.now().toString(36)}`;
    const admin = new Pool({ connectionString: DB_URL, max: 1 });
    const dir = join(PACKAGE_ROOT, `tmp-probe-${name}`);
    await admin.query(`CREATE DATABASE "${name}"`);
    try {
      const url = new URL(DB_URL ?? "");
      url.pathname = `/${name}`;
      const older = new Pool({ connectionString: url.toString(), max: 1 });
      await older.query('CREATE TABLE "Alpha" ("id" TEXT PRIMARY KEY)');
      await older.end();
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "schema.prisma"),
        'generator client {\n  provider = "prisma-client"\n  output = "./client"\n  importFileExtension = "ts"\n}\n' +
          'datasource db {\n  provider = "postgresql"\n}\nmodel Alpha {\n  id   String  @id\n  note String? @default("n")\n}\n',
      );
      await writeFile(
        join(dir, "prisma.config.mjs"),
        'export default { schema: "./schema.prisma" };\n',
      );
      await writeFile(join(dir, "probe.ts"), PROBE);
      const environment = { ...ENVIRONMENT, CHECKPOINT_DISABLE: "1" };
      const generated = await runTool({
        command: PRISMA_CLI,
        args: ["generate", "--config", "prisma.config.mjs"],
        cwd: dir,
        environment,
      });
      expect(generated.exitCode).toBe(0);
      const probe = await runTool({
        command: process.execPath,
        args: ["probe.ts", url.toString()],
        cwd: dir,
        environment,
      });
      const outcomes: unknown = JSON.parse(
        probe.output.split("\n").find((line) => line.startsWith("{")) ?? "{}",
      );
      expect(outcomes).toEqual({
        defaultSelect: "P2022",
        narrowSelect: "ok",
        createWithDefault: "P2022",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
