import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { writeReleaseDirectory } from "./release-directory.ts";
import { SteppingError } from "./stepping.errors.ts";
import { runTool, type ToolRun } from "./tool-run.ts";

/** One ClickHouse database goose steps; `table` is `<db>.goose_db_version`. */
export interface ClickHouseStepTarget {
  name: string;
  dsn: string;
  table: string;
  migrationsDir: string;
  environment?: Readonly<Record<string, string>>;
}

/** Where the two migration tools are; by default the package's `prisma` and `goose` on PATH. */
export interface SteppingTools {
  prisma?: { command: string; args: readonly string[] };
  goose?: string;
}

export type StepTargetReport =
  | { target: string; status: "applied"; applied: readonly string[] }
  | {
      target: string;
      status: "failed";
      applied: readonly string[];
      code: string | null;
      message: string;
    }
  | {
      target: string;
      status: "skipped";
      reason: "postgres_failed" | "aborted" | "no_clickhouse_version";
    };

export interface ReleaseApplyReport {
  release: string;
  ok: boolean;
  targets: readonly StepTargetReport[];
}

const POSTGRES_TARGET = "postgres";

/**
 * Applies one release's schema: `prisma migrate deploy` over a directory of every folder up to and
 * including the release, then goose `up-to` its last version on each ClickHouse target. Proofs of
 * both tools' behaviour: specs/upgrade/stepping.feature.
 */
export async function applyRelease({
  release,
  prismaFolders,
  gooseUpTo,
  postgresUrl,
  clickhouseTargets,
  environment,
  tools = {},
  signal,
}: {
  release: string;
  prismaFolders: readonly string[];
  gooseUpTo: number | null;
  postgresUrl: string;
  clickhouseTargets: readonly ClickHouseStepTarget[];
  environment: Readonly<Record<string, string | undefined>>;
  tools?: SteppingTools;
  signal?: AbortSignal;
}): Promise<ReleaseApplyReport> {
  if (gooseUpTo !== null && (!Number.isSafeInteger(gooseUpTo) || gooseUpTo < 1)) {
    throw new SteppingError({
      code: "invalid_goose_version",
      message: `Release ${release} names goose version ${gooseUpTo}; a positive integer is needed.`,
    });
  }
  const directory = await writeReleaseDirectory({ folders: prismaFolders });
  try {
    if (signal?.aborted) return skipAll({ release, clickhouseTargets, reason: "aborted" });
    const postgres = await deployPrisma({ directory, postgresUrl, environment, tools, signal });
    if (postgres.status !== "applied") {
      const reason = signal?.aborted ? "aborted" : "postgres_failed";
      return {
        release,
        ok: false,
        targets: [postgres, ...clickhouseTargets.map((target) => skipped(target.name, reason))],
      };
    }
    const clickhouse: StepTargetReport[] = [];
    for (const target of clickhouseTargets) {
      if (gooseUpTo === null) clickhouse.push(skipped(target.name, "no_clickhouse_version"));
      else if (signal?.aborted) clickhouse.push(skipped(target.name, "aborted"));
      else
        clickhouse.push(
          await gooseUpToVersion({ target, version: gooseUpTo, environment, tools, signal }),
        );
    }
    const targets = [postgres, ...clickhouse];
    return { release, ok: targets.every((target) => target.status !== "failed"), targets };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function deployPrisma({
  directory,
  postgresUrl,
  environment,
  tools,
  signal,
}: {
  directory: string;
  postgresUrl: string;
  environment: Readonly<Record<string, string | undefined>>;
  tools: SteppingTools;
  signal?: AbortSignal;
}): Promise<StepTargetReport> {
  const schema = join(directory, "schema.prisma");
  const config = join(directory, "prisma.config.mjs");
  await writeFile(schema, 'datasource db {\n  provider = "postgresql"\n}\n');
  const settings = { schema, migrations: { path: join(directory, "migrations") } };
  await writeFile(
    config,
    `const settings = ${JSON.stringify(settings)};\nexport default { ...settings, datasource: { url: process.env.DATABASE_URL } };\n`,
  );
  const prisma = tools.prisma ?? defaultPrisma();
  const run = await runTool({
    command: prisma.command,
    args: [...prisma.args, "migrate", "deploy", "--config", config],
    cwd: directory,
    environment: { ...environment, DATABASE_URL: postgresUrl, CHECKPOINT_DISABLE: "1" },
    signal,
  });
  const applied = [...run.output.matchAll(/^Applying migration `([^`]+)`/gm)].map((m) => m[1]!);
  if (run.exitCode === 0) return { target: POSTGRES_TARGET, status: "applied", applied };
  return failed({
    target: POSTGRES_TARGET,
    applied,
    run,
    code: /\bError: (P\d{4})\b/.exec(run.output)?.[1] ?? null,
    secrets: [postgresUrl],
  });
}

async function gooseUpToVersion({
  target,
  version,
  environment,
  tools,
  signal,
}: {
  target: ClickHouseStepTarget;
  version: number;
  environment: Readonly<Record<string, string | undefined>>;
  tools: SteppingTools;
  signal?: AbortSignal;
}): Promise<StepTargetReport> {
  const run = await runTool({
    command: tools.goose ?? "goose",
    args: [
      "-dir",
      target.migrationsDir,
      "-table",
      target.table,
      "clickhouse",
      target.dsn,
      "up-to",
      String(version),
    ],
    environment: { ...environment, ...target.environment },
    signal,
  });
  const applied = [...run.output.matchAll(/\bOK\s+(\d+)_/g)].map((m) => m[1]!);
  if (run.exitCode === 0) return { target: target.name, status: "applied", applied };
  const code = /found \d+ missing migrations/.test(run.output) ? "goose_missing_migrations" : null;
  return failed({ target: target.name, applied, run, code, secrets: [target.dsn] });
}

function failed({
  target,
  applied,
  run,
  code,
  secrets,
}: {
  target: string;
  applied: readonly string[];
  run: ToolRun;
  code: string | null;
  secrets: readonly string[];
}): StepTargetReport {
  const message = secrets.reduce(
    (text, secret) => text.split(secret).join("<redacted>"),
    run.output.trim(),
  );
  return { target, status: "failed", applied, code: run.aborted ? "aborted" : code, message };
}

function skipped(
  target: string,
  reason: "postgres_failed" | "aborted" | "no_clickhouse_version",
): StepTargetReport {
  return { target, status: "skipped", reason };
}

function skipAll({
  release,
  clickhouseTargets,
  reason,
}: {
  release: string;
  clickhouseTargets: readonly ClickHouseStepTarget[];
  reason: "aborted";
}): ReleaseApplyReport {
  const names = [POSTGRES_TARGET, ...clickhouseTargets.map((target) => target.name)];
  return { release, ok: false, targets: names.map((name) => skipped(name, reason)) };
}

function defaultPrisma(): { command: string; args: readonly string[] } {
  const manifest = createRequire(import.meta.url).resolve("prisma/package.json");
  return { command: process.execPath, args: [join(dirname(manifest), "build/index.js")] };
}
