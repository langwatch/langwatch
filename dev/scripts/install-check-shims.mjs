#!/usr/bin/env node
/**
 * Postinstall cleanup of the retired check-queue bin shims: restores each
 * marked tsc/oxlint/oxfmt/vitest entry from its intact `.real` backup.
 * Admission now lives in haven's hooks and `haven slot run`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = ["tsgo", "tsc", "oxlint", "oxfmt", "vitest"];
const MARKER = "langwatch-check-queue-shim";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
/**
 * Parent directories workspace member packages sit directly inside. Read
 * with two plain readdirs, no glob library: any child with a
 * `node_modules/.bin` is a member with its own bins.
 */
const MEMBER_PARENTS = [
  "apps",
  "packages",
  "modules",
  "enterprise/modules",
  "enterprise/packages/composition",
  "services",
  "mcp",
  "tools",
  "sdks",
];

/** Directory entries of `dir`, or none when it does not exist. */
function childDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Every `node_modules/.bin` in the workspace: the root's, plus each member's own. */
function discoverBinDirs(repoRoot) {
  const dirs = [path.join(repoRoot, "node_modules/.bin")];
  for (const parent of MEMBER_PARENTS) {
    for (const name of childDirs(path.join(repoRoot, parent))) {
      const member = `${parent}/${name}`;
      // modules/<feature> holds contract/process/browser, one level deeper.
      const candidates = [
        member,
        ...childDirs(path.join(repoRoot, member)).map((c) => `${member}/${c}`),
      ];
      for (const candidate of candidates) {
        const bin = path.join(repoRoot, candidate, "node_modules/.bin");
        if (fs.existsSync(bin)) dirs.push(bin);
      }
    }
  }
  return dirs;
}

/** The file's contents, or null if it cannot be read. */
function readIfText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function removeAll(binDirs) {
  const removed = [];
  for (const binDir of binDirs) {
    for (const name of TOOLS) {
      const entry = path.join(binDir, name);
      const entryText = readIfText(entry);
      if (!entryText?.includes(MARKER)) continue;

      const real = `${entry}.real`;
      try {
        fs.accessSync(real, fs.constants.X_OK);
        const realText = readIfText(real);
        if (realText?.includes(MARKER)) {
          throw new Error("launcher backup is itself a shim; run pnpm install");
        }
        fs.renameSync(real, entry);
        removed.push(name);
      } catch (err) {
        process.stderr.write(`check-queue: could not restore ${name} (${err.message})\n`);
      }
    }
  }
  return removed;
}

/** `[--remove] [binDir...]`: the flag is what postinstall has always passed. */
function main(argv) {
  if (process.platform === "win32") return 0;

  const dirs = argv[0] === "--remove" ? argv.slice(1) : argv;
  const removed = removeAll(dirs.length > 0 ? dirs : discoverBinDirs(REPO_ROOT));
  if (removed.length > 0) {
    process.stderr.write(`check-queue: restored ${removed.length} original tool launchers\n`);
  }
  return 0;
}

// Run only when invoked as a script; importing this module must not
// rewrite anybody's bin entries as a side effect.
const invokedPath = process.argv[1];
if (invokedPath !== undefined) {
  const resolvedInvokedPath = path.resolve(invokedPath);
  if (resolvedInvokedPath === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
  }
}
