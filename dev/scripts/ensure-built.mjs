#!/usr/bin/env node
// pnpm orders `build` topologically but has no graph for `dev`, so a lane that
// resolves a workspace package's `dist` can start before that package was ever
// built. Only two packages resolve `dist`; every other workspace package
// exports its own `src`. The SDK cannot join them until its 727 `@/*` aliases
// and 2,240 extensionless relative imports are rewritten.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const targets = [
  { name: "langwatch", dir: "sdks/typescript", entry: "dist/index.mjs" },
  { name: "@langwatch/mcp-server", dir: "mcp/typescript", entry: "dist/index.js" },
];

const mtime = (path) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

const newestUnder = (dir) => {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    newest = Math.max(newest, mtime(join(entry.parentPath ?? entry.path, entry.name)));
  }
  return newest;
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (const target of targets) {
  const dir = join(root, target.dir);
  const isFresh = () =>
    mtime(join(dir, target.entry)) >
    Math.max(newestUnder(join(dir, "src")), mtime(join(dir, "package.json")));
  if (isFresh()) continue;

  // The three dev lanes each run this hook, concurrently under haven and under
  // `pnpm dev`. Two tsup builds writing one `dist` would race, so the loser of
  // this mkdir waits for the winner instead of building too.
  const lock = join(dir, "node_modules", ".ensure-built.lock");
  try {
    mkdirSync(lock, { recursive: false });
  } catch {
    for (let i = 0; i < 900 && !isFresh(); i++) sleep(200);
    continue;
  }
  try {
    console.error(`ensure-built: building ${target.name} (${target.entry} missing or stale)`);
    execFileSync("pnpm", ["--filter", target.name, "build"], { cwd: root, stdio: "inherit" });
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
