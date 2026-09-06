#!/usr/bin/env node
/**
 * Type-check ONE workspace package, named however the caller already thinks of
 * it: `pnpm typecheck:one @langwatch/ui` or `pnpm typecheck:one apps/ui`.
 *
 * Project references are ruled out here, so `pnpm typecheck` is a fanout over
 * whole applications and there is no smaller unit to ask for. That is why
 * people `cd` into a package instead, and why they then run `tsc` in a way the
 * machine-wide queue cannot see. This resolves the package, picks its test
 * project (the strict superset — the same one `typecheck` runs), and hands the
 * run to `check-queue.mjs` so it counts against the same counter as everything
 * else.
 *
 *   node dev/scripts/typecheck-one.mjs <package-name-or-directory>
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The workspace globs, expanded by hand. `pnpm-workspace.yaml` is the source of
 * truth; this list is a plain depth-per-root table because the only shapes in
 * use are one and two levels deep.
 */
const PACKAGE_ROOTS = [
  { root: "apps", depth: 1 },
  { root: "packages", depth: 1 },
  { root: "packages/features", depth: 2 },
  { root: "packages/enterprise/composition", depth: 1 },
  { root: "packages/enterprise/features", depth: 2 },
  { root: "mcp", depth: 1 },
  { root: "plugins", depth: 1 },
  { root: "sdks", depth: 1 },
  { root: "services", depth: 1 },
  { root: "tools", depth: 2 },
];

function packageName(directory) {
  const manifest = join(directory, "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    return JSON.parse(readFileSync(manifest, "utf8")).name;
  } catch {
    return undefined;
  }
}

function* directoriesAt(root, depth) {
  const absolute = join(REPO_ROOT, root);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const child = join(root, entry.name);
    if (depth === 1) yield child;
    else yield* directoriesAt(child, depth - 1);
  }
}

/** Every workspace package directory, relative to the repo root. */
function workspacePackages() {
  const found = new Map();
  for (const { depth, root } of PACKAGE_ROOTS) {
    for (const directory of directoriesAt(root, depth)) {
      const name = packageName(join(REPO_ROOT, directory));
      if (name && !found.has(name)) found.set(name, directory);
    }
  }
  return found;
}

function resolveTarget(target) {
  const asDirectory = resolve(REPO_ROOT, target);
  if (existsSync(join(asDirectory, "package.json"))) return asDirectory;

  const byName = workspacePackages().get(target);
  if (byName) return join(REPO_ROOT, byName);
  return undefined;
}

/** The test project when there is one: it is the superset `typecheck` runs. */
function projectFor(directory) {
  for (const candidate of ["tsconfig.test.json", "tsconfig.json"]) {
    if (existsSync(join(directory, candidate))) return candidate;
  }
  return undefined;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

const target = process.argv[2];
if (!target) {
  fail(
    "Name the package to check: `pnpm typecheck:one @langwatch/ui` or `pnpm typecheck:one apps/ui`.",
  );
}

const directory = resolveTarget(target);
if (!directory) {
  const names = [...workspacePackages().keys()].sort();
  fail(
    `No workspace package called "${target}". Name one of its ${names.length} packages, or its directory.`,
  );
}

const project = projectFor(directory);
if (!project) {
  fail(`${target} has no tsconfig.json, so there is nothing to type-check.`);
}

const child = spawn(
  process.execPath,
  [
    join(REPO_ROOT, "dev", "scripts", "check-queue.mjs"),
    "pnpm",
    "exec",
    "tsc",
    "--noEmit",
    "-p",
    project,
  ],
  { cwd: directory, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
