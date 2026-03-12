/**
 * Resolves the command and arguments for spawning a scenario child process.
 *
 * In production, uses the pre-compiled esbuild bundle (node + dist/scenario-child-process.js).
 * In development, uses tsx to run the TypeScript source directly.
 *
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import fs from "fs";
import path from "path";

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
 * @throws Error if production bundle is missing
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
  return resolveDevelopmentSpawn(packageRoot);
}

function resolveProductionSpawn(packageRoot: string): SpawnConfig {
  const bundlePath = path.join(packageRoot, "dist", "scenario-child-process.js");

  if (!fs.existsSync(bundlePath)) {
    throw new Error(
      `Pre-compiled scenario child process bundle not found at ${bundlePath}. ` +
        `Run "pnpm run build:scenario-child-process" to generate it. ` +
        `The bundle is required in production to avoid tsx cold-start delays.`,
    );
  }

  return {
    command: "node",
    args: [bundlePath],
  };
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
