import { createConnection } from "node:net";

import chalk from "chalk";
import { execa } from "execa";

import { ownDatabases } from "../shared/databases.ts";
import { paths } from "../shared/paths.ts";
import type { PortAllocation } from "../shared/ports.ts";
import { appRoot } from "./app-dir.ts";
import { readEnvFile } from "./env-file.ts";
import { locateTasksDir, resolvePnpm } from "./node-deps.ts";
import { appOfflineEnv, FORCED_ENV } from "./offline-defaults.ts";

const UPGRADE_STATUS_TIMEOUT_MS = 60_000;
const DATABASE_PROBE_TIMEOUT_MS = 1_000;
const POSTGRES_DEFAULT_PORT = 5432;

/** The Postgres doctor reads the ledger from: the .env's own one, else the bundled one. */
export function upgradeStatusDatabaseUrl({
  env,
  ports,
}: {
  env: Record<string, string | undefined>;
  ports: PortAllocation;
}): string {
  const bundled = `postgresql://langwatch@127.0.0.1:${ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5`;
  const isBrought = ownDatabases({ env, ports }).includes("postgres");
  return isBrought ? (env.DATABASE_URL ?? bundled) : bundled;
}

function acceptsConnections({ databaseUrl }: { databaseUrl: string }): Promise<boolean> {
  if (!URL.canParse(databaseUrl)) return Promise.resolve(false);
  const target = new URL(databaseUrl);
  return new Promise((resolve) => {
    const socket = createConnection({
      host: target.hostname.replace(/^\[(.*)\]$/, "$1"),
      port: Number(target.port || POSTGRES_DEFAULT_PORT),
      timeout: DATABASE_PROBE_TIMEOUT_MS,
    });
    const settle = (accepted: boolean) => {
      socket.destroy();
      resolve(accepted);
    };
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/**
 * Prints what `pnpm task upgrade status` prints, so doctor and the Upgrades page read the
 * ledger the same way. It reads and changes nothing, and never decides doctor's exit code.
 */
export async function printUpgradeStatus({ databaseUrl }: { databaseUrl: string }): Promise<void> {
  console.log(chalk.bold("Upgrade"));
  const unavailable = (reason: string) =>
    console.log(`  ${chalk.yellow("-")} status unavailable: ${reason}`);
  if (!(await acceptsConnections({ databaseUrl }))) {
    unavailable("the database is not running (`npx @langwatch/server` starts it)");
    return;
  }
  const tasksDir = locateTasksDir();
  if (!tasksDir) {
    unavailable("the tasks directory is not installed next to this CLI");
    return;
  }
  // apps/tasks' `task` script; --silent keeps pnpm's own script header out of what is printed.
  const pnpm = await resolvePnpm(paths);
  const args = [...pnpm.args, "--silent", "run", "task", "upgrade", "status"];
  const result = await execa(pnpm.command, args, {
    cwd: tasksDir,
    env: {
      ...appOfflineEnv({ paths, appRootDir: appRoot() }),
      ...process.env,
      ...readEnvFile(paths.envFile),
      ...FORCED_ENV,
      DATABASE_URL: databaseUrl,
    },
    reject: false,
    timeout: UPGRADE_STATUS_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    const reason = (result.stderr || result.stdout).trim().split("\n").at(-1);
    unavailable(reason || `\`task upgrade status\` exited ${result.exitCode}`);
    return;
  }
  for (const line of result.stdout.trim().split("\n")) console.log(`  ${line}`);
}
