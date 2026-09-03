#!/usr/bin/env node
/**
 * Routes direct tsgo / tsc / oxlint / oxfmt invocations through the check queue.
 *
 * The queue only ever saw the package scripts. Anything that reached the
 * binary another way (`pnpm exec tsgo --noEmit -p tsconfig.tsgo.json`,
 * `./node_modules/.bin/tsgo`, an agent following the "iterate with targeted
 * checks" advice and then widening it to the whole project) was a 4 GiB run
 * the counter never knew about. Three tsgo processes on an 18 GB laptop with
 * the limit set to 2 is what that looks like.
 *
 * So the bin entries themselves become the boundary. `pnpm` generates
 * `node_modules/.bin/<tool>` as a small launcher; this moves that launcher to
 * `<tool>.real` and puts a shim in its place that runs it either directly or
 * under dev/scripts/check-queue.mjs, depending on the arguments.
 *
 * WHOLE-TREE runs queue: `-p`/`--project`, a directory argument, or nothing
 * that names an existing file (every one of these walks the whole project).
 * A positional argument only counts as a target if it exists, because a
 * subcommand and a flag's value (`--pretty false`) are positional too, and
 * reading either as a named file would let a whole-tree run through
 * uncounted.
 * TARGETED runs do not queue: `tsgo --noEmit src/foo.ts`, `tsc --noEmit a.ts
 * b.ts`. Those finish in a moment and are the entire point of the
 * iterate-fast loop, so making them wait behind a full typecheck would be a
 * worse trade than the pile-up this prevents.
 * LONG-LIVED runs do not queue either: `--watch` and `--lsp` would hold a slot
 * for the whole session.
 *
 * EVERY workspace member's bin dir is shimmed, not only the root's. A member
 * that declares `typescript` itself gets its own `node_modules/.bin/tsc`, and
 * `pnpm --filter <pkg> typecheck` resolves THAT one — so shimming only the root
 * left the applications' own typechecks, the heaviest runs on the machine,
 * entirely uncounted. `sdks/typescript` is the one exclusion: its build runs
 * `tsc --noEmit` on the way to `pnpm dev`, and a dev server that waits for a
 * typecheck slot before it boots is not an improvement.
 *
 * pnpm regenerates the bin entries on every install, so this runs from the
 * workspace root's postinstall and is idempotent: an entry that is already a
 * shim is left alone, and one that pnpm has overwritten is re-shimmed. It
 * never fails an install. A missing shim only costs the queue its accounting.
 *
 * Installs on CI (`CI` set to anything but `0` or `false`) and in production
 * are left alone entirely, see `skipReason`.
 *
 *   node dev/scripts/install-check-shims.mjs [binDir...]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The tools whose bin entries are shimmed.
 *
 * The typecheckers were the first, and the linter and the formatter belong for
 * the same reason: `oxlint apps packages/…` and `oxfmt --write .` walk the
 * whole tree and use every core, and neither is invoked through a wrapper any
 * more — the root scripts call the binaries directly. Shimming the bin is what
 * makes the queue's accounting complete regardless of how a run was started.
 *
 * The shim's classification is tool-agnostic on purpose: a directory argument
 * or no argument at all is a whole-tree run and queues; naming files is
 * targeted and stays instant. That reads `oxfmt --write .` and `oxlint --config
 * X apps …` as whole-tree, and `oxfmt --write src/one.ts` as targeted, which is
 * the same split it already made for tsc.
 */
export const TOOLS = ["tsgo", "tsc", "oxlint", "oxfmt"];
const MARKER = "langwatch-check-queue-shim";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const QUEUE = path.join(REPO_ROOT, "dev/scripts/check-queue.mjs");
/**
 * Where workspace members live, as the parent directories their package
 * directories sit directly inside. Read with two plain readdirs rather than a
 * glob library, and matched against nothing: every child that HAS a
 * `node_modules/.bin` is a member with its own bins, and every child that does
 * not is skipped without a stat of its own.
 */
const MEMBER_PARENTS = [
  "apps",
  "packages",
  "packages/features",
  "packages/enterprise/features",
  "packages/enterprise/composition",
  "services",
  "mcp",
  "tools",
  "sdks",
];

/**
 * Members whose bins are deliberately left alone. `sdks/typescript` builds on
 * the way to `pnpm dev`; a dev server queueing behind somebody's typecheck is
 * a worse trade than the accounting is worth.
 */
const EXCLUDED_MEMBERS = new Set(["sdks/typescript"]);

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

/**
 * Every `node_modules/.bin` in the workspace: the root's, plus each member's
 * own. A member that declares none of the tools has no such directory, or has
 * one holding other binaries, and either way nothing here is created — only
 * existing entries are ever rewritten.
 */
function discoverBinDirs(repoRoot) {
  const dirs = [path.join(repoRoot, "node_modules/.bin")];
  for (const parent of MEMBER_PARENTS) {
    for (const name of childDirs(path.join(repoRoot, parent))) {
      const member = `${parent}/${name}`;
      if (EXCLUDED_MEMBERS.has(member)) continue;
      // packages/features/<feature> holds contract/server/web, one level deeper.
      const candidates = [member, ...childDirs(path.join(repoRoot, member)).map((c) => `${member}/${c}`)];
      for (const candidate of candidates) {
        const bin = path.join(repoRoot, candidate, "node_modules/.bin");
        if (fs.existsSync(bin)) dirs.push(bin);
      }
    }
  }
  return dirs;
}

const DEFAULT_BIN_DIRS = discoverBinDirs(REPO_ROOT);

/**
 * The shim. POSIX sh rather than node so the targeted path, the one that has
 * to stay instant, pays nothing to find out it is not queued.
 */
function shimSource({ name, queuePath }) {
  // The queue path is absolute on purpose. A relative one has to climb out of
  // node_modules, and `..` resolves physically: on macOS a bin dir reached
  // through /var (a symlink to /private/var) ends up one level short, the
  // shim finds no queue, and every run silently goes unqueued. pnpm's own
  // launchers embed absolute paths for the same reason, and a moved checkout
  // needs `pnpm install` either way, which regenerates both.
  return `#!/bin/sh
# ${MARKER}, generated by dev/scripts/install-check-shims.mjs. Do not edit.
# Runs ${name} under the machine-wide check queue when the invocation walks the
# whole project, and directly when it names files. See CHECK_SLOTS.
real="$(dirname "$0")/${name}.real"
queue="${queuePath}"

if [ ! -x "$real" ]; then
  echo "${name}: shim is installed but ${name}.real is missing, run pnpm install" >&2
  exit 127
fi

whole_tree=0
named_a_target=0
for arg in "$@"; do
  case "$arg" in
    # A watch or a language server holds its slot for the whole session.
    --watch|-w|--lsp) exec "$real" "$@" ;;
    --help|-h|--version|-v|--init) exec "$real" "$@" ;;
    -p|--project|--project=*) whole_tree=1 ;;
    -*) ;;
    *)
      # Only something that exists is a target. A subcommand and a flag's
      # value (\`--pretty false\`, \`--max-diagnostics 1000\`) are positional
      # too, and counting either as a named file is what turns a whole-tree
      # run into one nothing waits behind.
      if [ -e "$arg" ]; then
        named_a_target=1
        if [ -d "$arg" ]; then whole_tree=1; fi
      fi
      ;;
  esac
done
# Naming nothing means the tool walks the whole project from the cwd.
if [ "$named_a_target" -eq 0 ]; then whole_tree=1; fi

if [ "$whole_tree" -eq 1 ]; then
  if [ -f "$queue" ]; then
    exec node "$queue" "$real" "$@"
  fi
  # Never block the check over a broken install, but never do it quietly
  # either: silence here reads as "the queue is working" while nothing is
  # being counted.
  echo "checks: no queue at $queue, running ${name} unqueued" >&2
fi
exec "$real" "$@"
`;
}

/**
 * Why this environment keeps pnpm's own bin entries, or null to shim them.
 *
 * The shims are a laptop concern. On CI the queue is off anyway (a job runs
 * one check at a time, so `resolveSlots` reads CI the same way and returns 0),
 * which leaves the shim adding a node process in front of every tsc run to
 * decide nothing. A production install has less business still: rewriting
 * bin entries in an image or on a server buys no laptop any RAM, and the
 * shim's queue path is absolute, so a stage that copies node_modules without
 * `dev/` gets an indirection that only ever prints that it found no queue.
 */
function skipReason(env) {
  const ci = (env.CI ?? "").trim().toLowerCase();
  if (ci !== "" && ci !== "0" && ci !== "false") return "CI";
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    return "NODE_ENV=production";
  }
  return null;
}

/** The file's contents, or null if it cannot be read. */
function readIfText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Puts `contents` at `entry`, moving pnpm's launcher to `.real` first when
 * `moveLauncher` says the entry still holds one.
 *
 * The shim is written and made executable off to the side, and both renames
 * are within one directory, so no failure partway through can leave the bin
 * entry empty. Losing the queue's accounting is an acceptable outcome here.
 * Leaving a developer without `tsgo` on their PATH is not.
 */
function replaceEntry({ entry, contents, moveLauncher }) {
  const real = `${entry}.real`;
  const staged = `${entry}.shim-staging`;
  fs.writeFileSync(staged, contents, "utf8");
  fs.chmodSync(staged, 0o755);
  try {
    if (moveLauncher) fs.renameSync(entry, real);
    try {
      fs.renameSync(staged, entry);
    } catch (err) {
      if (moveLauncher) fs.renameSync(real, entry);
      throw err;
    }
  } catch (err) {
    fs.rmSync(staged, { force: true });
    throw err;
  }
}

function installOne(binDir, name) {
  const entry = path.join(binDir, name);
  if (!fs.existsSync(entry)) return false;

  const wanted = shimSource({ name, queuePath: QUEUE });
  const current = readIfText(entry);
  if (current === wanted) return false;

  // A shim from an older version of this script is replaced rather than left
  // alone, or a change to the shim's own text would never reach a checkout
  // that has already been installed once. Its launcher is already parked at
  // `.real`, though, so moving the entry aside again would bury the launcher
  // under a stale shim and lose the tool.
  replaceEntry({
    entry,
    contents: wanted,
    moveLauncher: !current?.includes(MARKER),
  });
  return true;
}

/** Shims every tool present in each directory, and names the ones it changed. */
function installAll(binDirs) {
  const installed = [];
  for (const binDir of binDirs) {
    for (const name of TOOLS) {
      try {
        if (installOne(binDir, name)) installed.push(name);
      } catch (err) {
        // An install must never fail over this. Losing the shim costs the
        // queue its accounting for direct invocations, nothing else.
        process.stderr.write(`check-queue: could not shim ${name} (${err.message})\n`);
      }
    }
  }
  return installed;
}

function main(argv, env) {
  if (process.platform === "win32") return 0;

  const skip = skipReason(env);
  if (skip !== null) {
    // Said out loud rather than skipped quietly: a hand-run that does nothing
    // is otherwise indistinguishable from one that worked.
    process.stderr.write(`check-queue: leaving bin entries alone (${skip})\n`);
    return 0;
  }

  const installed = installAll(argv.length > 0 ? argv : DEFAULT_BIN_DIRS);
  if (installed.length > 0) {
    process.stderr.write(
      `check-queue: whole-project ${installed.join(", ")} runs now take a slot (CHECK_SLOTS)\n`,
    );
  }
  return 0;
}

// Run only when invoked as a script (`node dev/scripts/install-check-shims.mjs`,
// which is what postinstall does). Importing this module — the guard test reads
// TOOLS from it, so the list it asserts against is the list the installer uses
// — must not rewrite anybody's bin entries as a side effect.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
