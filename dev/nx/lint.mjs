import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeDiagnostics } from "../../packages/oxlint-rules/src/unused-directives.mjs";
import { memberRoots, ownLintMembers } from "./workspace-members.mjs";

// `pnpm lint`: oxlint's native rules and the langwatch plugin as two parallel
// processes over the tree; `--types` adds the type-aware rules as a third, over the
// TypeScript projects. One unused-directive check spans the processes. `--changed`
// and `--base <sha>` narrow to the projects a change reached. ADR-150, TOOLING.md.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OXLINT = join(root, "node_modules/.bin/oxlint");
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;
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

/** The union config's ignorePatterns: `extends` does not carry them to the parts. */
function ignoreArgs() {
  const printed = spawnSync(OXLINT, ["--print-config", "-c", ".oxlintrc.jsonc"], {
    cwd: root,
    encoding: "utf8",
  });
  if (printed.status !== 0) throw new Error(`oxlint --print-config failed:\n${printed.stdout}`);

  return JSON.parse(printed.stdout).ignorePatterns.flatMap((p) => ["--ignore-pattern", p]);
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

  return roots.filter((member) => names.has(nameOf(member)));
}

/** What each process lints: projects, plus the files no Nx `lint` target owns. */
function scopes({ types, files, base }) {
  const own = new Set(ownLintMembers(root).map((member) => member.root));
  const members = memberRoots(root).filter((member) => !own.has(member));
  if (types) {
    const typed = memberRoots(root).filter((m) => existsSync(join(root, m, "tsconfig.json")));
    return [{ paths: affectedRoots({ roots: typed, files, base }), ignores: [] }];
  }
  if (files === undefined && base === undefined) return [{ paths: ["."], ignores: [] }];
  const outside = (file) => !members.some((member) => file.startsWith(`${member}/`));
  const lintable = files?.filter((file) => LINTABLE.test(file) && existsSync(join(root, file)));
  const residual = lintable === undefined ? ["."] : lintable.filter(outside);
  const ignores = members.flatMap((member) => ["--ignore-pattern", `${member}/**`]);

  return [
    { paths: affectedRoots({ roots: members, files, base }), ignores: [] },
    { paths: residual, ignores },
  ];
}

/** The diagnostics of a `-f json` run; undefined when oxlint printed an error instead. */
function parseReport(out) {
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

const flags = process.argv.slice(2);
const baseFlag = flags.indexOf("--base");
const types = flags.includes("--types");
const base = baseFlag === -1 ? undefined : flags[baseFlag + 1];
const files = flags.includes("--changed") ? changedFiles(mergeBase()) : undefined;
if (files?.length === 0) process.exit(0);

const ignored = ignoreArgs();
const configs = types ? TYPES : PLAIN;
const runs = scopes({ types, files, base })
  .filter((scope) => scope.paths.length > 0)
  .map(async ({ paths, ignores }) => {
    const args = [...ignored, ...ignores, ...paths];
    const reports = await Promise.all(configs.map((config) => oxlint({ config, args })));

    return reports.includes(undefined) ? undefined : mergeDiagnostics({ reports });
  });
const results = await Promise.all(runs);
const diagnostics = results.flatMap((result) => result ?? []);
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
