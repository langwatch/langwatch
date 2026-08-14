/**
 * Resolves the command and arguments for spawning a scenario child process.
 *
 * In production, uses the pre-compiled esbuild bundle (node + dist/server/scenario-child-process.cjs).
 * If the bundle is missing, this resolver logs the remediation and returns the
 * tsx command rather than throwing. That fallback only actually runs where dev
 * dependencies are present: tsx is a devDependency, so the Docker image and the
 * published npx tree both prune it and the spawn fails there — a missing bundle
 * is a build fault to fix, not a degraded mode to live in.
 * Outside production the bundle is still used while it is current, because tsx
 * costs seconds on every spawn. It is dropped the moment any child source is
 * newer, so editing the child still takes effect without a rebuild.
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
 * Production always uses the pre-compiled bundle. Every other value
 * (development, test, staging, undefined) uses it too while it is newer than
 * the child's sources, and tsx otherwise.
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

  // Outside production the bundle is an optimisation rather than a
  // requirement, so it is used only while it is demonstrably current. tsx
  // costs seconds on every spawn — measured at 4-6s alone and ~10s with the
  // pool's three running at once — and a simulation pays that per run, which
  // is the difference between a run starting promptly and a suite crawling.
  //
  // Currency is decided by mtime against the child's own sources: edit any of
  // them and the next spawn returns to tsx by itself, so the fast path can
  // never run code you did not build. Rebuild with `pnpm run build:server`.
  const bundlePath = bundlePathFor(packageRoot);
  if (isBundleCurrent({ packageRoot, bundlePath })) {
    logger.debug({ bundlePath }, "Using pre-compiled bundle for child process");
    return { command: "node", args: [bundlePath] };
  }

  logger.debug(
    { nodeEnv: nodeEnv ?? "undefined" },
    "Using tsx for child process",
  );
  return resolveDevelopmentSpawn(packageRoot);
}

function bundlePathFor(packageRoot: string): string {
  return path.join(packageRoot, "dist", "server", "scenario-child-process.cjs");
}

/**
 * True when the bundle exists and nothing under the child's source tree is
 * newer than it.
 *
 * The whole `scenarios/execution` tree is checked, not just the entry point:
 * the child pulls in the adapters, the model factory and the serialized
 * adapter registry, and a change to any of those is as much a reason to stop
 * trusting the bundle. Anything unreadable counts as stale, so every failure
 * direction lands on tsx rather than on stale code.
 */
function isBundleCurrent({
  packageRoot,
  bundlePath,
}: {
  packageRoot: string;
  bundlePath: string;
}): boolean {
  let bundleMtimeMs: number;
  try {
    bundleMtimeMs = fs.statSync(bundlePath).mtimeMs;
  } catch {
    return false;
  }

  try {
    return !hasFileNewerThan(
      path.join(packageRoot, "src", "server", "scenarios", "execution"),
      bundleMtimeMs,
    );
  } catch {
    return false;
  }
}

/** Depth-first scan that stops at the first file newer than `thresholdMs`. */
function hasFileNewerThan(dir: string, thresholdMs: number): boolean {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasFileNewerThan(full, thresholdMs)) return true;
      continue;
    }
    if (fs.statSync(full).mtimeMs > thresholdMs) return true;
  }
  return false;
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
