/**
 * Resolves the command and arguments for spawning a scenario child process.
 *
 * In production, uses the pre-compiled esbuild bundle (node + dist/scenario-child-process.js).
 * If the bundle is missing, falls back to tsx with a loud warning (never crashes).
 * In development, uses tsx to run the TypeScript source directly.
 *
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import fs from "fs";
import path from "path";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:scenarios:child-process-spawn");

export interface SpawnConfig {
  command: string;
  args: string[];
}

/**
 * Resolves the spawn command and args for the scenario child process.
 *
 * Only NODE_ENV === "production" uses the pre-compiled bundle.
 * All other values (development, test, staging, undefined) use tsx.
 *
 * @param packageRoot - Absolute path to the langwatch package root
 * @param nodeEnv - Current NODE_ENV value
 * @returns Command and args to pass to child_process.spawn
 */
export function resolveChildProcessSpawn({
  packageRoot,
  nodeEnv,
}: {
  packageRoot: string;
  nodeEnv: string | undefined;
}): SpawnConfig {
  if (nodeEnv === "production") {
    return resolveProductionSpawn(packageRoot);
  }

  logger.debug({ nodeEnv: nodeEnv ?? "undefined" }, "Using tsx for child process");
  return resolveDevelopmentSpawn(packageRoot);
}

function resolveProductionSpawn(packageRoot: string): SpawnConfig {
  const bundlePath = path.join(packageRoot, "dist", "scenario-child-process.js");

  if (fs.existsSync(bundlePath)) {
    logger.info({ bundlePath }, "Spawning child process from pre-compiled bundle");
    return {
      command: "node",
      args: [bundlePath],
    };
  }

  logger.error(
    { bundlePath },
    "Pre-compiled scenario child process bundle NOT FOUND. " +
      "Falling back to tsx — this will cause slow cold-starts (~4 min). " +
      'Run "pnpm run build:scenario-child-process" to fix this.',
  );

  return resolveDevelopmentSpawn(packageRoot);
}

function resolveDevelopmentSpawn(packageRoot: string): SpawnConfig {
  const tsSourcePath = path.join(
    packageRoot,
    "src",
    "server",
    "scenarios",
    "execution",
    "scenario-child-process.ts",
  );

  return {
    command: "pnpm",
    args: ["exec", "tsx", tsSourcePath],
  };
}
