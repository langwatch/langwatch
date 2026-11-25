/**
 * Spawn command resolver: production uses pre-compiled bundle or fallback tsx,
 * dev uses bundle if current else tsx. See specs/scenarios/pre-compiled-child-process.feature.
 */

import fs from "fs";
import path from "path";

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:scenarios:child-process-spawn");

interface SpawnConfig {
  command: string;
  args: string[];
}

/**
 * Spawn command resolver: production requires the bundle (throws if missing), dev uses bundle if
 * current else tsx (edit child -> next spawn uses tsx, no rebuild needed).
 */
export class ScenarioChildSpawn {
  static create(): ScenarioChildSpawn {
    return new ScenarioChildSpawn();
  }

  private constructor() {}

  resolve({
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
      return resolveProductionSpawn(packageRoot);
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

function bundlePathFor(packageRoot: string): string {
  return path.join(packageRoot, "dist", "server", "scenario-child-process.mjs");
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
 * Whether any child source is newer than `thresholdMs`. Stops at the first
 * match rather than a full stat of the tree, since this runs between a run
 * queuing and its child starting. `__tests__` is skipped: it can't affect the bundle.
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

function resolveProductionSpawn(packageRoot: string): SpawnConfig {
  const bundlePath = path.join(packageRoot, "dist", "server", "scenario-child-process.mjs");

  if (fs.existsSync(bundlePath)) {
    logger.info({ bundlePath }, "Spawning child process from pre-compiled bundle");
    return {
      command: "node",
      args: [bundlePath],
    };
  }

  // No tsx fallback here: production images prune dev dependencies, so `pnpm exec tsx`
  // would try `pnpm install` and fail minutes later with an unrelated error. Fail now.
  const message =
    "Pre-compiled scenario child process bundle NOT FOUND at " +
    `${bundlePath}. The image must build @langwatch/scenario-child ` +
    '(run "pnpm run build:server", or the Dockerfile build step).';
  logger.error({ bundlePath }, message);
  throw new Error(message);
}

function resolveDevelopmentSpawn(sourcePath: string): SpawnConfig {
  return {
    command: "pnpm",
    args: ["exec", "tsx", sourcePath],
  };
}
