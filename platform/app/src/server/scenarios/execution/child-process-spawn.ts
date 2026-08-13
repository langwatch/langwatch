/**
 * Resolves the command and arguments for spawning a scenario child process.
 *
 * In production, uses the pre-compiled esbuild bundle (node + dist/server/scenario-child-process.cjs).
 * If the bundle is missing, this resolver logs the remediation and returns the
 * tsx command rather than throwing. That fallback only actually runs where dev
 * dependencies are present: tsx is a devDependency, so the Docker image and the
 * published npx tree both prune it and the spawn fails there — a missing bundle
 * is a build fault to fix, not a degraded mode to live in.
 * In development, uses tsx to run the TypeScript source directly.
 *
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { createLogger } from "@langwatch/observability";
import fs from "fs";
import path from "path";

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

  logger.debug(
    { nodeEnv: nodeEnv ?? "undefined" },
    "Using tsx for child process",
  );
  return resolveDevelopmentSpawn(packageRoot);
}

function resolveProductionSpawn(packageRoot: string): SpawnConfig {
  const bundlePath = path.join(
    packageRoot,
    "dist",
    "server",
    "scenario-child-process.cjs",
  );

  if (fs.existsSync(bundlePath)) {
    logger.info(
      { bundlePath },
      "Spawning child process from pre-compiled bundle",
    );
    return {
      command: "node",
      args: [bundlePath],
    };
  }

  logger.error(
    { bundlePath },
    "Pre-compiled scenario child process bundle NOT FOUND. " +
      "Falling back to tsx — this costs ~4 min cold-starts, and it only works " +
      "where dev dependencies are installed. The Docker image and the npx " +
      "install prune tsx, so there this spawn fails outright. " +
      'Run "pnpm run build:server" to fix this.',
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
