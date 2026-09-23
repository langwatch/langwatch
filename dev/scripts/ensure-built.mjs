#!/usr/bin/env node
// pnpm has no `dev` graph, so a lane resolving a workspace `dist` can start
// before that package built. Only three packages resolve `dist` (the
// rest export `src`); `@langwatch/mail` joined because Node can't load
// its `.tsx` templates directly, so it compiles first.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const targets = [
  { name: "langwatch", dir: "sdks/typescript", entry: "dist/index.mjs" },
  { name: "@langwatch/mcp-server", dir: "mcp/typescript", entry: "dist/index.js" },
  // Before mail: ksuid's `types` condition names its `dist`, and with no
  // declaration on disk mail's `tsc` falls back to checking ksuid's vendored
  // SOURCE under mail's own strictness — 26 errors that exist only on a fresh
  // worktree, where nothing has built ksuid yet.
  { name: "@langwatch/ksuid", dir: "packages/ksuid", entry: "dist/index.d.ts" },
  { name: "@langwatch/mail", dir: "packages/mail", entry: "dist/index.js" },
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

// A named argument narrows the run to one package. `predev` wants all of them;
// a test hook wants only `@langwatch/mail`, and building the SDK to run a unit
// suite would cost a minute for nothing.
const requested = process.argv.slice(2);
const selected = requested.length
  ? targets.filter((target) => requested.includes(target.name))
  : targets;
const unknown = requested.filter((name) => !targets.some((target) => target.name === name));
if (unknown.length) {
  console.error(`ensure-built: no such target: ${unknown.join(", ")}`);
  process.exit(1);
}

for (const target of selected) {
  const dir = join(root, target.dir);
  const entryPath = join(dir, target.entry);
  // Only SOURCE staleness matters: package.json content never changes what
  // an incremental build emits. Comparing against it made staleness permanent
  // once package.json was edited after the last real build -- an
  // unchanged-source rebuild writes nothing, so entry's mtime never caught up.
  const isFresh = () => mtime(entryPath) > newestUnder(join(dir, "src"));
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
    // An incremental compiler that finds nothing changed writes nothing, so
    // entry's mtime may still trail a source file touched only cosmetically
    // (a reformat, a comment). Stamp it "now" so this run's freshness holds
    // even then -- self-correcting, instead of trusting the tool's own writes.
    const now = new Date();
    try {
      utimesSync(entryPath, now, now);
    } catch (error) {
      const reason = error instanceof Error ? error.message : JSON.stringify(error);
      console.error(`ensure-built: could not stamp ${target.entry}: ${reason}`);
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
