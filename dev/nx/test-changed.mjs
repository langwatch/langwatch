#!/usr/bin/env node
// `pnpm test:changed [files...] [--list|--json] [--reads] [--base REF]`: runs the Vitest
// test files a change reaches by imports, each through its own package's `test`
// script. No files means the diff from the merge base with origin/main,
// untracked files included. ADR-182, specs/tooling/test-changed.feature.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, matchesGlob, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { buildImportGraph, isTestFile, reachedFrom } from "./import-graph.mjs";
import { reads } from "./test-reads-plugin.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_FILE = join(root, "node_modules/.cache/test-changed/import-graph.json");
const DEFAULT_CONFIG = /^vitest\.config\.[cm]?[jt]s$/;
const VITEST_SCRIPT = /^vitest run(?: [^&|;<>`$\n\r]*)?$/;

function git({ args, cwd = root, allowFailure = false }) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return [];
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout.split("\n").filter(Boolean);
}

/** Committed, staged, unstaged and untracked changes since `base`. */
export function changedSince({ base, cwd = root }) {
  const tracked = git({ args: ["diff", "--name-only", "--diff-filter=ACMRD", base], cwd });
  const untracked = git({ args: ["ls-files", "--others", "--exclude-standard"], cwd });

  return [...new Set([...tracked, ...untracked])].toSorted((a, b) => a.localeCompare(b));
}

/** The merge base with origin/main; HEAD when origin/main is not there. */
export function defaultBase({ cwd = root } = {}) {
  const [base] = git({ args: ["merge-base", "HEAD", "origin/main"], cwd, allowFailure: true });

  return base ?? "HEAD";
}

/**
 * Names what is wrong with the named arguments. An option-like argument is
 * unknown; a file in the graph, on disk or tracked in HEAD (a deleted file)
 * is real, anything else is a typo or a package-relative path.
 */
export function checkNamed({ named, known, cwd = root }) {
  const problems = [];
  for (const arg of named) {
    if (arg.startsWith("-")) {
      problems.push(`unknown option ${arg}`);
      continue;
    }
    const tracked = git({ args: ["ls-tree", "HEAD", "--", arg], cwd, allowFailure: true });
    const inHead = tracked.length > 0;
    if (!known(arg) && !existsSync(join(cwd, arg)) && !inHead)
      problems.push(`${arg} is not a file in this repository (paths are from the repository root)`);
  }

  return problems;
}

/** Every workspace package with its directory, name and `test` script. */
export function readPackages({ files, readText }) {
  return files
    .filter((file) => basename(file) === "package.json" && !file.includes("node_modules/"))
    .flatMap((file) => {
      try {
        const manifest = JSON.parse(readText(file));
        return [
          {
            dir: posix.dirname(file),
            name: manifest.name,
            test: manifest.scripts?.test,
            pretest: manifest.scripts?.pretest,
          },
        ];
      } catch {
        return [];
      }
    });
}

/** The package whose directory holds `file` most closely. */
function owner({ packagesByDir, file }) {
  const segments = posix.dirname(file).split("/");
  for (let depth = segments.length; depth >= 0; depth--) {
    const found = packagesByDir.get(depth === 0 ? "." : segments.slice(0, depth).join("/"));
    if (found !== undefined) return found;
  }

  return void 0;
}

/** The config a package's `vitest run` script loads, from the default configs by directory. */
function configOf({ pkg, defaults }) {
  const named = /--config[=\s]+(\S+)/.exec(pkg.test)?.[1];

  return named === undefined ? defaults.get(pkg.dir) : posix.join(pkg.dir, named);
}

/** Packages whose whole suite runs: a reached config, or a changed file their tests read. */
function wholeSuites({ graph, packages, changed, reached, readsTable }) {
  const defaults = new Map(
    graph.files
      .filter((file) => DEFAULT_CONFIG.test(basename(file)))
      .map((file) => [posix.dirname(file), file]),
  );
  const reachedSet = new Set(reached);

  return packages.flatMap((pkg) => {
    const config = configOf({ pkg, defaults });
    const readers = readsTable[pkg.name] ?? [];
    const read = changed.find((file) => readers.some((glob) => matchesGlob(file, glob)));
    const imported = reachedSet.has(config) ? config : void 0;
    if (imported === undefined && read === undefined) return [];

    return [{ pkg, because: [imported, read].filter(Boolean), onlyRead: imported === undefined }];
  });
}

/**
 * Per Vitest package, its reached test files or its whole suite. A suite that
 * only reads the change from disk runs with `withReads`, else it is listed, as
 * are tests no Vitest package owns. Ordered so the first result comes soonest.
 */
export function planRuns({
  graph,
  packages,
  changed,
  reached,
  withReads = false,
  readsTable = reads,
}) {
  const isVitest = (pkg) => pkg !== undefined && VITEST_SCRIPT.test(pkg.test ?? "");
  const packagesByDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));
  const suites = wholeSuites({
    graph,
    packages: packages.filter(isVitest),
    changed,
    reached,
    readsTable,
  });
  const whole = suites.filter((suite) => withReads || !suite.onlyRead);
  const readers = suites.filter((suite) => !withReads && suite.onlyRead);
  const wholeDirs = new Set(whole.map(({ pkg }) => pkg.dir));
  const filesByDir = new Map();
  const notVitest = [];
  const tests = reached.filter((file) => isTestFile(file));
  for (const file of tests) {
    const pkg = owner({ packagesByDir, file });
    if (!isVitest(pkg)) notVitest.push(file);
    else if (!wholeDirs.has(pkg.dir)) {
      if (!filesByDir.has(pkg.dir)) filesByDir.set(pkg.dir, { pkg, files: [] });
      filesByDir.get(pkg.dir).files.push(posix.relative(pkg.dir, file));
    }
  }
  const describe = ({ pkg, because = [], files = [] }) => ({
    dir: pkg.dir,
    name: pkg.name,
    script: pkg.test,
    pretest: pkg.pretest,
    whole: because.length > 0,
    because,
    files: files.toSorted(),
  });
  const byDir = (a, b) => a.dir.localeCompare(b.dir);
  const edited = new Set(changed.map((file) => owner({ packagesByDir, file })?.dir));
  const soonest = (a, b) =>
    Number(edited.has(b.dir)) - Number(edited.has(a.dir)) ||
    a.files.length - b.files.length ||
    byDir(a, b);
  const runs = [
    ...[...filesByDir.values()].map(describe).toSorted(soonest),
    ...whole.map(describe).toSorted(byDir),
  ];

  return {
    reached: reached.length,
    runs,
    readers: readers.map(describe).toSorted(byDir),
    notVitest: notVitest.toSorted(),
  };
}

/** The summary of a plan, as the lines test:changed prints to stderr. */
export function formatPlan({ plan, changed, graphStats, walkMs }) {
  const testFiles = plan.runs.reduce((sum, run) => sum + run.files.length, 0);
  const whole = plan.runs.filter((run) => run.whole).length;
  const lines = [
    `test:changed: ${changed.length} changed file(s) reach ${plan.reached} file(s): ` +
      `${testFiles} test file(s) in ${plan.runs.length - whole} package(s), ` +
      `${whole} whole suite(s). Graph ${graphStats.ms.total} ms ` +
      `(${graphStats.rescanned} file(s) rescanned), walk ${walkMs.toFixed(2)} ms.`,
  ];
  for (const run of plan.runs) {
    const what = run.whole
      ? `whole suite (${run.because.join(", ")} changed)`
      : `${run.files.length} file(s)`;
    lines.push(`  ${run.name ?? run.dir}: ${what}`);
  }
  if (plan.readers.length > 0) {
    const names = plan.readers.map((run) => `${run.name ?? run.dir} (${run.because.join(", ")})`);
    lines.push(`  not run, read the change from disk (pass --reads to run): ${names.join(", ")}`);
  }
  if (plan.notVitest.length > 0) {
    lines.push(`  not run (no Vitest test script owns them): ${plan.notVitest.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The plan as one JSON line, as `--json` prints it. */
export function planJson({ plan, changed, graphMs, walkMs }) {
  return `${JSON.stringify({ changed, ...plan, graph: graphMs, walkMs })}\n`;
}

/** One path per reached test file, as `--list` prints them. */
export function formatFileList(plan) {
  return plan.runs.flatMap((run) => run.files.map((file) => `${run.dir}/${file}\n`)).join("");
}

/** Runs one package's `test` script with the reached files appended. */
async function runPackage(run) {
  const extra = run.script.includes("--passWithNoTests") ? [] : ["--passWithNoTests"];
  const cwd = join(root, run.dir);
  const bins = [join(cwd, "node_modules/.bin"), join(root, "node_modules/.bin")];
  const env = { ...process.env, PATH: [...bins, process.env.PATH].join(":") };
  process.stderr.write(
    `\n> ${run.name ?? run.dir}: ${run.script} ${[...extra, ...run.files].join(" ")}\n`,
  );
  const start = ({ command, args }) =>
    new Promise((resolve) => {
      const child = spawn("sh", ["-c", command, "sh", ...args], { cwd, env, stdio: "inherit" });
      child.on("close", (status) => resolve(status ?? 1));
    });

  return runCommands({ commands: commandsFor({ run, extra }), start });
}

/** pnpm runs a package's `pretest` before `test`; running the script directly must too. */
export function commandsFor({ run, extra = [] }) {
  const test = { command: `${run.script} "$@"`, args: [...extra, ...run.files] };

  return run.pretest === undefined ? [test] : [{ command: run.pretest, args: [] }, test];
}

/** Runs the commands in order and stops at the first one that fails. */
export async function runCommands({ commands, start }) {
  for (const command of commands) {
    const status = await start(command);
    if (status !== 0) return status;
  }

  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const baseFlag = args.indexOf("--base");
  const base = baseFlag === -1 ? void 0 : args[baseFlag + 1];
  const flags = new Set(["--list", "--json", "--reads", "--base", base]);
  const named = args.filter((arg) => !flags.has(arg));
  const baseMissing = baseFlag !== -1 && (base === undefined || base.startsWith("-"));
  const normalized = named.map((file) => posix.normalize(file).replace(/^\.\//, ""));
  const graph = buildImportGraph({ root, cacheFile: CACHE_FILE });
  const problems = [
    ...(baseMissing ? ["--base needs a ref"] : []),
    ...checkNamed({ named: normalized, known: (file) => graph.index.has(file) }),
  ];
  if (problems.length > 0) {
    process.stderr.write(`test:changed: ${problems.join("\ntest:changed: ")}\n`);
    process.exit(2);
  }
  const changed =
    normalized.length > 0 ? normalized : changedSince({ base: base ?? defaultBase() });
  if (changed.length === 0) {
    process.stderr.write("test:changed: nothing changed.\n");
    process.exit(0);
  }

  const packages = readPackages({
    files: graph.files,
    readText: (file) => readFileSync(join(root, file), "utf8"),
  });
  const walkStarted = performance.now();
  const reached = reachedFrom({ graph, changed });
  const walkMs = performance.now() - walkStarted;
  const plan = planRuns({ graph, packages, changed, reached, withReads: args.includes("--reads") });

  if (args.includes("--json")) {
    process.stdout.write(planJson({ plan, changed, graphMs: graph.stats.ms, walkMs }));
    process.exit(0);
  }
  process.stderr.write(formatPlan({ plan, changed, graphStats: graph.stats, walkMs }));
  if (args.includes("--list")) {
    process.stdout.write(formatFileList(plan));
    process.exit(0);
  }

  const failed = [];
  for (const run of plan.runs) {
    const status = await runPackage(run);
    if (status !== 0) failed.push(run.name ?? run.dir);
  }
  if (failed.length > 0) process.stderr.write(`\ntest:changed: failed in ${failed.join(", ")}\n`);

  process.exit(failed.length === 0 ? 0 : 1);
}

const runDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (runDirectly) await main();
