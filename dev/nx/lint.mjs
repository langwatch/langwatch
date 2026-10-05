import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { memberRoots, ownLintMembers } from "./workspace-members.mjs";

// `pnpm lint`: the fast oxlint layer as one cached Nx target per project, plus the
// files outside every project. `--changed` lints what the working copy and branch
// changed; `--base <sha>` what a PR changed. ADR-150 and dev/docs/TOOLING.md say why.
// `--types` runs the lint:types projects in one type-aware process, which parses each
// shared dependency once instead of once per project.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;
const UPSTREAM_FALLBACK = "origin/feat/strict-feature-layout-v0";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });

  return result.status ?? 1;
}

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

  return [...new Set([...tracked, ...untracked])].toSorted();
}

function residualArgs({ files }) {
  const own = new Set(ownLintMembers(root).map((member) => member.root));
  const ignored = memberRoots(root).filter((member) => !own.has(member));
  const outside = (file) => !ignored.some((member) => file.startsWith(`${member}/`));
  const targets = files === undefined ? ["."] : files.filter(outside);
  if (targets.length === 0) return undefined;

  return [
    "exec",
    "oxlint",
    "--quiet",
    "--config",
    ".oxlintrc.jsonc",
    ...ignored.flatMap((member) => ["--ignore-pattern", `${member}/**`]),
    ...targets,
  ];
}

function nxArgs({ scope }) {
  const exclude = ownLintMembers(root)
    .map((member) => member.name)
    .join(",");

  return ["exec", "nx", ...scope, "--exclude", exclude];
}

/** The lint:types projects (a tsconfig.json at the root) the scope names; all when unscoped. */
function typedRoots({ files, base }) {
  const typed = memberRoots(root).filter((member) =>
    existsSync(join(root, member, "tsconfig.json")),
  );
  if (files === undefined && base === undefined) return typed;
  const affected = base === undefined ? `--files=${files.join(",")}` : `--base=${base}`;
  const show = ["exec", "nx", "show", "projects", "--affected", affected, "--json"];
  const listed = spawnSync("pnpm", show, {
    cwd: root,
    encoding: "utf8",
  });
  if (listed.status !== 0) process.exit(listed.status ?? 1);
  const names = new Set(JSON.parse(listed.stdout));
  const nameOf = (member) =>
    JSON.parse(readFileSync(join(root, member, "package.json"), "utf8")).name;

  return typed.filter((member) => names.has(nameOf(member)));
}

function typesArgs({ roots }) {
  return ["exec", "oxlint", "--quiet", "--type-aware", "--config", ".oxlintrc.jsonc", ...roots];
}

const flags = process.argv.slice(2);
const baseFlag = flags.indexOf("--base");
const changed = flags.includes("--changed");
const base = baseFlag === -1 ? undefined : flags[baseFlag + 1];
const files = changed ? changedFiles(mergeBase()) : undefined;
const lintable = files?.filter((file) => LINTABLE.test(file) && existsSync(join(root, file)));

let scope = ["run-many", "-t", "lint"];
if (changed) scope = ["affected", "-t", "lint", `--files=${files.join(",")}`];
if (base !== undefined) scope = ["affected", "-t", "lint", `--base=${base}`];

if (flags.includes("--types")) {
  const roots = changed && files.length === 0 ? [] : typedRoots({ files, base });
  process.exit(roots.length === 0 ? 0 : run("pnpm", typesArgs({ roots })));
}

const skip = changed && files.length === 0;
const projects = skip ? 0 : run("pnpm", nxArgs({ scope }));
const residual = residualArgs({ files: lintable });
const outside = residual === undefined ? 0 : run("pnpm", residual);

process.exit(projects === 0 && outside === 0 ? 0 : 1);
