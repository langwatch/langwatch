#!/usr/bin/env node
// pnpm orders `build` topologically but has no graph for `dev`, so a lane that
// resolves a workspace package's `dist` can start before that package was ever
// built. Only three packages resolve `dist`; every other workspace package
// exports its own `src`. `@langwatch/mail` joined them because Node cannot load
// a `.tsx` file: its templates are the only JSX on a server boot graph, so the
// package compiles and the three processes import the compiled entry.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const targets = [
  { name: "langwatch", dir: "sdks/typescript", entry: "dist/index.mjs" },
  { name: "@langwatch/mcp-server", dir: "mcp/typescript", entry: "dist/index.js" },
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
