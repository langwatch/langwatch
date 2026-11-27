import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeDiagnostics } from "../../packages/oxlint-rules/src/unused-directives.mjs";
import { memberRoots } from "./workspace-members.mjs";

// `pnpm lint`: oxlint's native rules and the langwatch plugin as two parallel processes;
// `--types` adds the type-aware rules as a third. One unused-directive check spans them.
// `--changed` lints the working tree's changes itself. Otherwise a plain run lints its
// scope (`--base <sha>`: the changed files) through the cached `workspace:lint:tree`
// target, and `--types` runs every project's cached `lint:types`. ADR-150, TOOLING.md.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OXLINT = join(root, "node_modules/.bin/oxlint");
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;
// oxlint exits 1 with this line when every path it got is ignored: nothing to lint.
const NO_FILES = "No files found to lint.";
const UPSTREAM_FALLBACK = "origin/feat/strict-feature-layout-v0";
const PLAIN = [".oxlintrc.native.jsonc", ".oxlintrc.plugin.jsonc"];
const TYPES = [...PLAIN, ".oxlintrc.types.jsonc"];

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });

  return result.status === 0 ? result.stdout.split("\n").filter(Boolean) : [];
}

function mergeBase() {
  const [upstream] = git(["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const [base] = git(["merge-base", "HEAD", upstream ?? UPSTREAM_FALLBACK]);

  return base ?? git(["merge-base", "HEAD", "origin/main"])[0];
}

/** Committed, staged, unstaged and untracked changes since the merge base. */
function changedFiles(base) {
  const tracked = git(["diff", "--name-only", "--diff-filter=ACMRD", base]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);

  return [...new Set([...tracked, ...untracked])].toSorted((a, b) => a.localeCompare(b));
}

function printedConfig(config) {
  const printed = spawnSync(OXLINT, ["--print-config", "-c", config], {
    cwd: root,
    encoding: "utf8",
  });
  if (printed.status !== 0) throw new Error(`oxlint --print-config failed:\n${printed.stdout}`);

  return JSON.parse(printed.stdout);
}

/** The union config's ignorePatterns: `extends` does not carry them to the parts. */
function ignoreArgs() {
  return printedConfig(".oxlintrc.jsonc").ignorePatterns.flatMap((p) => ["--ignore-pattern", p]);
}

const ruleName = (rule) => rule.trim().split("/").at(-1);
const UNUSED = /^Unused (?:eslint|oxlint)-[a-z-]+ directive/;

/** A run without the type-aware rules cannot judge a directive that names only them. */
function judgedWithoutTypes() {
  const typeOnly = new Set(Object.keys(printedConfig(".oxlintrc.types.jsonc").rules).map(ruleName));

  return (diagnostic) => {
    if (diagnostic.code !== undefined || !UNUSED.test(diagnostic.message)) return true;
    const { offset, length } = diagnostic.labels?.[0]?.span ?? { offset: 0, length: 0 };
    const source = readFileSync(join(root, diagnostic.filename));
    const text = source.subarray(offset, offset + length).toString("utf8");
    const rules = /disable(?:-next-line|-line)?\s+([^*\n]*?)(?:\s+--|\*\/|$)/m.exec(text)?.[1];
    const names = rules?.split(",").map(ruleName).filter(Boolean) ?? [];

    return names.length === 0 || !names.every((name) => typeOnly.has(name));
  };
}

/** Workspace roots a change reached, dependents included; every root when unscoped. */
function affectedRoots({ roots, files, base }) {
  if (files === undefined && base === undefined) return roots;
  const affected = base === undefined ? `--files=${files.join(",")}` : `--base=${base}`;
  const show = ["exec", "nx", "show", "projects", "--affected", affected, "--json"];
  const listed = spawnSync("pnpm", show, { cwd: root, encoding: "utf8" });
  if (listed.status !== 0) process.exit(listed.status ?? 1);
  const names = new Set(JSON.parse(listed.stdout));
  const nameOf = (member) =>
    JSON.parse(readFileSync(join(root, member, "package.json"), "utf8")).name;

  return widenedScope({ roots, reached: roots.filter((member) => names.has(nameOf(member))) });
}

/**
 * Past half the projects a scoped type-aware run costs about a full one, and the full
 * scope is the one main runs, so main replays the pull request's result from the cache.
 */
export function widenedScope({ roots, reached }) {
  return reached.length * 2 > roots.length ? roots : reached;
}

/** nx.json's `lintGlobals` as root-relative globs: editing one re-lints everything. */
function lintGlobals() {
  const { namedInputs } = JSON.parse(readFileSync(join(root, "nx.json"), "utf8"));
  const expand = (input) =>
    (namedInputs[input] ?? [input]).flatMap((i) => (i === input ? [i] : expand(i)));

  return expand("lintGlobals").map((glob) => glob.replace("{workspaceRoot}/", ""));
}

/** A plain run's scope: the changed lintable files, or the tree when a lint global changed. */
export function plainScope({ files, globals }) {
  const isGlobal = (file) => globals.some((glob) => matchesGlob(file, glob));
  const globalChanged = files.some(isGlobal);
  if (globalChanged) return ["."];

  return files.filter((file) => LINTABLE.test(file) && existsSync(join(root, file)));
}

/** What each process lints: typed projects a change reached, or the plain scope. */
function scopes({ types, files, base }) {
  if (types) {
    const typed = memberRoots(root).filter((m) => existsSync(join(root, m, "tsconfig.json")));
    return [{ paths: affectedRoots({ roots: typed, files, base }), ignores: [] }];
  }
  if (files === undefined && base === undefined) return [{ paths: ["."], ignores: [] }];
  const changed = files ?? changedFiles(base);

  return [{ paths: plainScope({ files: changed, globals: lintGlobals() }), ignores: [] }];
}

/** The diagnostics of a `-f json` run; undefined when oxlint printed an error instead. */
export function parseReport(out) {
  if (out.startsWith(NO_FILES)) return [];
  try {
    return JSON.parse(out).diagnostics;
  } catch {
    return undefined;
  }
}

/** One oxlint process; resolves to its diagnostics, or undefined when it failed to run. */
function oxlint({ config, args }) {
  const typeAware = config === ".oxlintrc.types.jsonc" ? ["--type-aware"] : [];
  const child = spawn(OXLINT, ["--quiet", "-f", "json", "-c", config, ...typeAware, ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));

  return new Promise((resolve) => {
    child.on("close", (status) => {
      const report = status === 0 || status === 1 ? parseReport(out) : undefined;
      if (report === undefined)
        process.stderr.write(`oxlint -c ${config} exited ${status}:\n${out}\n`);
      resolve(report);
    });
  });
}

function print(diagnostic) {
  const { line, column } = diagnostic.labels?.[0]?.span ?? { line: 0, column: 0 };
  const rule = diagnostic.code === undefined ? "" : ` [${diagnostic.code}]`;
  const help = diagnostic.help === undefined ? "" : `\n  help: ${diagnostic.help}`;

  return `${diagnostic.filename}:${line}:${column}: ${diagnostic.message}${rule}${help}`;
}

/** Runs one Nx command; resolves its exit status. */
function nxStatus(args) {
  const env = { ...process.env, FORCE_COLOR: "0", NX_LOAD_DOT_ENV_FILES: "false" };
  const run = spawnSync("pnpm", ["exec", "nx", ...args, "--outputStyle=static"], {
    cwd: root,
    stdio: "inherit",
    env,
  });

  return run.status ?? 1;
}

const nx = (args) => process.exit(nxStatus(args));

/**
 * Every project's `lint:types`, after every `typecheck` wrote the declarations it reads.
 * Two runs, not a dependsOn: with no task dependencies Nx batches every miss into one
 * oxlint run (dev/nx/executors/lint-types.mjs) instead of one per dependency level.
 */
function lintProjects() {
  const typecheck = nxStatus(["run-many", "-t", "typecheck"]);
  const lint = nxStatus(["run-many", "-t", "lint:types"]);

  process.exit(typecheck || lint);
}

/** Lints the resolved paths through Nx, which replays a run whose inputs and paths it saw. */
function lintThroughNx({ paths }) {
  nx(["run", "workspace:lint:tree", "--", "--resolved", ...paths]);
}

/**
 * Lint the paths Nx handed back (`resolved`), the working tree's changes (`direct`), every
 * project's cached `lint:types` (`projects`, `--base` ignored), or a resolved plain scope
 * through Nx (`nx`).
 */
export function routeFlags(flags) {
  const baseFlag = flags.indexOf("--base");
  const types = flags.includes("--types");
  const base = baseFlag === -1 ? undefined : flags[baseFlag + 1];
  if (flags.includes("--resolved")) {
    const paths = flags.filter((flag, i) => !flag.startsWith("--") && flags[i - 1] !== "--base");
    return { route: "resolved", types, paths };
  }
  if (flags.includes("--changed")) return { route: "direct", types };
  if (types) return { route: "projects", types };

  return { route: "nx", types, base };
}

/** The scopes this process lints itself; a run Nx should cache is handed to it instead. */
function ownScopes(flags) {
  const decision = routeFlags(flags);
  const { types } = decision;
  if (decision.route === "resolved") return [{ paths: decision.paths, ignores: [] }];
  if (decision.route === "direct") {
    const files = changedFiles(mergeBase());
    if (files.length === 0) process.exit(0);
    return scopes({ types, files, base: undefined });
  }
  if (decision.route === "projects") return lintProjects();
  const paths = scopes({ types, files: undefined, base: decision.base }).flatMap((s) => s.paths);
  if (paths.length === 0) process.exit(0);

  return lintThroughNx({ paths });
}

async function main() {
  const flags = process.argv.slice(2);
  const types = flags.includes("--types");
  const resolvedScopes = ownScopes(flags);

  const ignored = ignoreArgs();
  const configs = types ? TYPES : PLAIN;
  const runs = resolvedScopes
    .filter((scope) => scope.paths.length > 0)
    .map(async ({ paths, ignores }) => {
      const args = [...ignored, ...ignores, ...paths];
      const reports = await Promise.all(configs.map((config) => oxlint({ config, args })));

      return reports.includes(undefined) ? undefined : mergeDiagnostics({ reports });
    });
  const results = await Promise.all(runs);
  const judged = types ? () => true : judgedWithoutTypes();
  const diagnostics = results.flatMap((result) => result ?? []).filter(judged);
  const position = (d) => [
    d.filename,
    d.labels?.[0]?.span.line ?? 0,
    d.labels?.[0]?.span.column ?? 0,
  ];
  const byPosition = (a, b) => {
    const [fa, la, ca] = position(a);
    const [fb, lb, cb] = position(b);

    return fa.localeCompare(fb) || la - lb || ca - cb;
  };
  process.stdout.write(
    diagnostics
      .toSorted(byPosition)
      .map((d) => `${print(d)}\n`)
      .join(""),
  );
  process.stdout.write(`\n${diagnostics.length} problem(s)\n`);

  process.exit(diagnostics.length === 0 && !results.includes(undefined) ? 0 : 1);
}

const runDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (runDirectly) await main();
