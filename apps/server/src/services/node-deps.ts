import { existsSync } from "node:fs";
import { join } from "node:path";

import { execa } from "execa";

import type { LangwatchPaths } from "../shared/paths.ts";
import { appRoot } from "./app-dir.ts";

// Resolve pnpm: bundled > PATH > corepack fallback. Prefer deterministic bundled version.
export async function resolvePnpm(
  paths?: LangwatchPaths,
): Promise<{ command: string; args: string[] }> {
  if (paths) {
    const bundled = join(paths.bin, "pnpm");
    if (existsSync(bundled)) return { command: bundled, args: [] };
  }
  const direct = await execa("pnpm", ["--version"], { reject: false });
  if (direct.exitCode === 0) return { command: "pnpm", args: [] };
  const { exitCode } = await execa("corepack", ["--version"], {
    reject: false,
  });
  if (exitCode === 0) return { command: "corepack", args: ["pnpm"] };
  throw new Error("pnpm not found in <bin>/pnpm, on PATH, or via corepack");
}

// Locate an application directory in the app tree (the prebuilt app, or the checkout).
function locateAppDir(name: "backend" | "tasks"): string | null {
  const dir = join(appRoot(), "apps", name);
  return existsSync(join(dir, "package.json")) ? dir : null;
}

/** The one Node process the CLI spawns: the api and the worker together. */
export function locateBackendDir(): string | null {
  return locateAppDir("backend");
}

/** The task-launcher process — prisma-migrate, clickhouse-migrate, lwql-provision. */
export function locateTasksDir(): string | null {
  return locateAppDir("tasks");
}
