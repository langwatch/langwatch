// Loaded into each Vitest worker with `--import` (see ../module-loading-cache.ts). Answers
// Node's resolution of installed packages, and their sources, from two files under this
// worktree's node_modules/.cache, so a fresh worker skips thousands of stats and reads.
import { appendFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";

import { CacheFile } from "./cache-file.ts";
import { createModuleLoadingHooks } from "./module-loading-hooks.ts";

function workspaceRoot(from: string): string | undefined {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
    if (statSync(join(dir, "pnpm-lock.yaml"), { throwIfNoEntry: false })) return dir;
  }
  return undefined;
}

/** What an install changes: the lockfile, and the state pnpm rewrites on every install. */
function installState(root: string): string {
  return ["pnpm-lock.yaml", "node_modules/.modules.yaml"]
    .map((file) => {
      const stat = statSync(join(root, file), { throwIfNoEntry: false });
      return `${file}:${stat?.size}:${stat?.mtimeMs}:${stat?.ino}`;
    })
    .join("\n");
}

const root = workspaceRoot(import.meta.dirname);
if (root !== undefined) {
  const dir = join(root, "node_modules", ".cache", "vitest-module-loading");
  const salt = [
    installState(root),
    process.version,
    process.platform,
    process.arch,
    process.execArgv.includes("--preserve-symlinks"),
  ].join("\n");
  const resolutions = new CacheFile({ dir, name: "resolutions", salt });
  const sources = new CacheFile({ dir, name: "sources", salt });
  const { resolve, load, counts } = createModuleLoadingHooks({ resolutions, sources });
  registerHooks({ resolve, load });

  // Vitest ends a forked worker with SIGTERM, which skips 'exit' unless someone listens.
  if (typeof process.send === "function") process.once("SIGTERM", () => process.exit());
  process.once("exit", () => {
    const pending = resolutions.pending + sources.pending;
    resolutions.save();
    sources.save();
    const statsFile = process.env.LANGWATCH_VITEST_MODULE_CACHE_STATS;
    if (statsFile) {
      appendFileSync(statsFile, `${JSON.stringify({ pid: process.pid, ...counts, pending })}\n`);
    }
  });
}
