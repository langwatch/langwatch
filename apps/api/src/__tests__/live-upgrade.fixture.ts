/**
 * The upgrade a live boot needs before it serves, run once per test process in apps/tasks with
 * only the test stores' URLs: never `.env`, never `--env-file` (`pnpm task` adds one when a
 * `.env` exists, so the entry is spawned directly). Spec: specs/upgrade/live-test-fixtures.feature.
 */
import { spawn } from "node:child_process";

import { TASKS_APP_DIRECTORY } from "@langwatch/upgrade/gate";

/** The test stores the upgrade runs against; ClickHouse is the fixture's own migrated database. */
export type LiveUpgradeStores = { databaseUrl: string; redisUrl: string; clickHouseUrl: string };

export type LiveUpgradeOutcome = { exitCode: number; output: string };

/** Runs one upgrade in the given environment and answers its exit code and output. */
export type RunLiveUpgrade = (
  environment: Readonly<Record<string, string>>,
) => Promise<LiveUpgradeOutcome>;

/** What the fixture spawns: the tasks entry itself, so no env file is ever named. */
export const LIVE_UPGRADE_COMMAND = {
  command: process.execPath,
  args: ["--experimental-transform-types", "src/main.ts", "upgrade"],
  cwd: TASKS_APP_DIRECTORY,
} as const;

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

/** The whole environment the upgrade sees: the test stores, NODE_ENV and PATH (for goose). */
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
    DATABASE_URL: stores.databaseUrl,
    REDIS_URL: stores.redisUrl,
    CLICKHOUSE_URL: stores.clickHouseUrl,
  };
}

/** Spawns {@link LIVE_UPGRADE_COMMAND}, collecting its output; a launch failure answers 1. */
export const spawnLiveUpgrade: RunLiveUpgrade = (environment) =>
  new Promise((resolve) => {
    const { command, args, cwd } = LIVE_UPGRADE_COMMAND;
    const child = spawn(command, [...args], { cwd, env: { ...environment }, stdio: "pipe" });
    const chunks: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    child.once("error", (error) => resolve({ exitCode: 1, output: `${chunks.join("")}${error}` }));
    child.once("close", (code) => resolve({ exitCode: code ?? 1, output: chunks.join("") }));
  });

/**
 * Upgrades the test database at most once per test process: every later boot shares the first
 * outcome, a failure included, so a failed upgrade is never re-spawned per test.
 */
export function createLiveUpgrade({
  run,
  path = process.env.PATH,
}: {
  run: RunLiveUpgrade;
  path?: string;
}): (stores: LiveUpgradeStores) => Promise<void> {
  let upgraded: Promise<void> | undefined;
  return (stores) =>
    (upgraded ??= run(liveUpgradeEnvironment({ stores, path })).then((outcome) => {
      if (outcome.exitCode !== 0) throw new LiveUpgradeFailedError(outcome);
    }));
}

/** This test process's one upgrade of the live test database. */
export const upgradedLiveDatabase = createLiveUpgrade({ run: spawnLiveUpgrade });
