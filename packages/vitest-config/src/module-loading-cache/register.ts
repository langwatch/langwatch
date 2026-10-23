// Loaded into each Vitest worker with `--import` (see ../module-loading-cache.ts). Answers
// Node's resolution of installed packages, and their sources, from two files under this
// worktree's node_modules/.cache, so a fresh worker skips thousands of stats and reads.
import { registerHooks } from "node:module";
import { join } from "node:path";

import { CacheFile } from "./cache-file.ts";
import { cacheSalt, workspaceRoot } from "./install-salt.ts";
import { createModuleLoadingHooks } from "./module-loading-hooks.ts";

const root = workspaceRoot(import.meta.dirname);
if (root !== undefined) {
  const dir = join(root, "node_modules", ".cache", "vitest-module-loading");
  const salt = cacheSalt({ root });
  const resolutions = new CacheFile({ dir, name: "resolutions", salt });
  const sources = new CacheFile({ dir, name: "sources", salt });
  const { resolve, load } = createModuleLoadingHooks({ resolutions, sources });
  registerHooks({ resolve, load });

  const save = () => {
    resolutions.save();
    sources.save();
  };
  // Vitest ends a forked worker with SIGTERM, which skips 'exit'. Save, then re-raise it
  // with no listener left, so the worker still dies by the signal.
  if (typeof process.send === "function") {
    process.once("SIGTERM", () => {
      save();
      process.kill(process.pid, "SIGTERM");
    });
  }
  process.once("exit", save);
}
