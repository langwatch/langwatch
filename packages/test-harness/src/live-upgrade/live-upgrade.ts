/**
 * The upgrade a live boot needs before it serves, run once per test process in apps/tasks with
 * only the test stores' URLs: never `.env`, never `--env-file` (`pnpm task` adds one when a
 * `.env` exists, so the entry is spawned directly). Spec: specs/upgrade/live-test-fixtures.feature.
 */
import { spawn } from "node:child_process";

/** The test stores the upgrade runs against; ClickHouse is the fixture's own migrated database. */
export type LiveUpgradeStores = { databaseUrl: string; redisUrl: string; clickHouseUrl: string };

export type LiveUpgradeOutcome = { exitCode: number; output: string };

/** Runs one upgrade in the given environment and answers its exit code and output. */
export type RunLiveUpgrade = (
  environment: Readonly<Record<string, string>>,
) => Promise<LiveUpgradeOutcome>;

/** What the fixture spawns: the tasks entry itself, so no env file is ever named. */
export function liveUpgradeCommand({ tasksDirectory }: { tasksDirectory: string }) {
  return {
    command: process.execPath,
    args: ["--experimental-transform-types", "src/main.ts", "upgrade"],
    cwd: tasksDirectory,
  } as const;
}

const OUTPUT_TAIL_CHARACTERS = 8_000;

/** The upgrade exited non-zero; the live boot that asked for it fails by this code. */
export class LiveUpgradeFailedError extends Error {
  readonly code = "live_upgrade_failed";
  constructor(readonly outcome: LiveUpgradeOutcome) {
    super(
      `The live test database's upgrade (pnpm task upgrade) exited ${outcome.exitCode}; no server was booted. Its output:\n${outcome.output.slice(-OUTPUT_TAIL_CHARACTERS)}`,
    );
  }
}

/**
 * Throwaway deployment facts the upgrade's module tree refuses to boot without; never real
 * secrets.
 */
const LIVE_UPGRADE_SYNTHETIC: Readonly<Record<string, string>> = {
  BASE_HOST: "http://langwatch.test",
  NEXTAUTH_URL: "http://langwatch.test",
  API_KEY_PEPPER: "synthetic-api-key-pepper",
};

/**
 * The whole environment the upgrade sees: the test stores, NODE_ENV, PATH (for goose) and the
 * synthetic facts.
 */
export function liveUpgradeEnvironment({
  stores,
  path,
}: {
  stores: LiveUpgradeStores;
  path: string | undefined;
}): Readonly<Record<string, string>> {
  return {
    ...(path ? { PATH: path } : {}),
    NODE_ENV: "test",
    ...LIVE_UPGRADE_SYNTHETIC,
    DATABASE_URL: stores.databaseUrl,
    REDIS_URL: stores.redisUrl,
    CLICKHOUSE_URL: stores.clickHouseUrl,
  };
}

/** Spawns {@link liveUpgradeCommand}, collecting its output; a launch failure answers 1. */
export function spawnLiveUpgrade({ tasksDirectory }: { tasksDirectory: string }): RunLiveUpgrade {
  const { command, args, cwd } = liveUpgradeCommand({ tasksDirectory });
  return (environment) =>
    new Promise((resolve) => {
      const child = spawn(command, [...args], { cwd, env: { ...environment }, stdio: "pipe" });
      const chunks: string[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
      child.once("error", (error) =>
        resolve({ exitCode: 1, output: `${chunks.join("")}${error}` }),
      );
      child.once("close", (code) => resolve({ exitCode: code ?? 1, output: chunks.join("") }));
    });
}

/**
 * Upgrades the test database at most once per test process: every later boot shares the first
 * outcome, a failure included, so a failed upgrade is never re-spawned per test. `path` is the
 * caller's PATH, which goose is found on.
 */
export function createLiveUpgrade({
  run,
  path,
}: {
  run: RunLiveUpgrade;
  path: string | undefined;
}): (stores: LiveUpgradeStores) => Promise<void> {
  let upgraded: Promise<void> | undefined;
  return (stores) =>
    (upgraded ??= run(liveUpgradeEnvironment({ stores, path })).then((outcome) => {
      if (outcome.exitCode !== 0) throw new LiveUpgradeFailedError(outcome);
    }));
}
