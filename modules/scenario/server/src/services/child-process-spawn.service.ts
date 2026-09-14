/**
 * Spawn command resolver: production uses pre-compiled bundle or fallback tsx,
 * dev uses bundle if current else tsx. See specs/scenarios/pre-compiled-child-process.feature.
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
 * Spawn command resolver: production uses bundle or tsx fallback, dev uses bundle if
 * current else tsx (edit child -> next spawn uses tsx, no rebuild needed).
 */
export class ChildProcessSpawnAdapter {
  static create(): ChildProcessSpawnAdapter {
    return new ChildProcessSpawnAdapter();
  }

  private constructor() {}

  static resolve({
    packageRoot,
    nodeEnv,
    sourcePath,
    sourceRoots,
  }: {
    packageRoot: string;
    nodeEnv: string | undefined;
    sourcePath: string;
    sourceRoots: string[];
  }): SpawnConfig {
    if (nodeEnv === "production") {
      return resolveProductionSpawn(packageRoot, sourcePath);
    }

    // Bundle is optimisation, used if current; tsx costs 4-6s per spawn.
    // mtime check: edit any child source -> next spawn uses tsx (no rebuild needed).
    const bundlePath = bundlePathFor(packageRoot);
    if (isBundleCurrent({ bundlePath, sourceRoots })) {
      logger.debug({ bundlePath }, "Using pre-compiled bundle for child process");
      return { command: "node", args: [bundlePath] };
    }

    logger.debug({ nodeEnv: nodeEnv ?? "undefined" }, "Using tsx for child process");
    return resolveDevelopmentSpawn(sourcePath);
  }
}

export const resolveChildProcessSpawn = ChildProcessSpawnAdapter.resolve;

function bundlePathFor(packageRoot: string): string {
  return path.join(packageRoot, "dist", "server", "scenario-child-process.cjs");
}

/**
 * True when bundle exists and nothing in `scenarios/execution` tree is newer.
 * Any unreadable file counts as stale, landing on tsx rather than stale code.
 */
function isBundleCurrent({
  bundlePath,
  sourceRoots,
}: {
  bundlePath: string;
  sourceRoots: string[];
}): boolean {
  let bundleMtimeMs: number;
  try {
    bundleMtimeMs = fs.statSync(bundlePath).mtimeMs;
  } catch {
    return false;
  }

  try {
    return sourceRoots.every((sourceRoot) => !hasFileNewerThan(sourceRoot, bundleMtimeMs));
  } catch {
    return false;
  }
}

/**
 * Whether any child source is newer than `thresholdMs`.
 *
 * The answer is a single boolean, so the scan stops at the first match rather
 * than costing a full stat of the execution tree on every spawn — this runs on
 * the path between a run being queued and its child starting. `__tests__` is
 * skipped because editing a test never changes what the bundle would contain.
 */
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

function resolveProductionSpawn(packageRoot: string, sourcePath: string): SpawnConfig {
  const bundlePath = path.join(packageRoot, "dist", "server", "scenario-child-process.cjs");

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
      "Falling back to tsx — this costs ~4 min cold-starts, and it only works " +
      "where dev dependencies are installed. The Docker image and the npx " +
      "install prune tsx, so there this spawn fails outright. " +
      'Run "pnpm run build:server" to fix this.',
  );

  return resolveDevelopmentSpawn(sourcePath);
}

function resolveDevelopmentSpawn(sourcePath: string): SpawnConfig {
  return {
    command: "pnpm",
    args: ["exec", "tsx", sourcePath],
  };
}
