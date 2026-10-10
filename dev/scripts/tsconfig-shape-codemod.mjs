#!/usr/bin/env node
// Narrows each package's tsconfigs so `tsc -b` checks every file once and references only
// what the source imports (dev/docs/plans/typescript-cpu-and-check-time.md steps 4 and 7).
// Idempotent. Usage: node dev/scripts/tsconfig-shape-codemod.mjs [package dirs...], then
// `pnpm sync:references` and `pnpm install --lockfile-only`. Fails if a test config's file
// set would differ from (its old set minus the build's).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fromNx = createRequire(createRequire(join(root, "package.json")).resolve("@nx/js"));
const ts = fromNx("typescript");
const jsonc = fromNx("jsonc-parser");

// Another session owns these packages.
const SKIPPED = ["packages/upgrade", "tools/upgradelab", "apps/tasks"];
// Hand-written ignores the source does import or read; each carries its own comment.
const HAND_IGNORED = {
  "modules/langy/browser": ["@langwatch/skills"],
  "packages/observability": ["langwatch"],
};
const MARKER =
  "// Workspace dependencies no source or test file imports get no reference (tsconfig-shape-codemod).";
const READ_FILE = /\.(?:[cm]?[jt]sx?|css|html)$/;
const UNSCANNED_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".turbo"]);
const formattingOptions = { insertSpaces: true, tabSize: 2 };
const written = new Set();
const problems = [];
const counts = { testConfigs: 0, ignoreConfigs: 0, removed: 0, moved: 0 };

const read = (file) => readFileSync(file, "utf8");
const readConfig = (file) => jsonc.parse(read(file), [], { allowTrailingComma: true }) ?? {};
const edit = ({ text, path, value }) =>
  jsonc.applyEdits(text, jsonc.modify(text, path, value, { formattingOptions }));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function write({ file, text }) {
  const body = text.endsWith("\n") ? text : `${text}\n`;
  if (read(file) === body) return false;
  writeFileSync(file, body);
  written.add(relative(root, file));
  return true;
}

function expand(glob) {
  let directories = [""];
  for (const segment of glob.split("/")) {
    directories = directories.flatMap((directory) => {
      if (segment !== "*")
        return existsSync(join(root, directory, segment)) ? [join(directory, segment)] : [];
      return readdirSync(join(root, directory), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .filter((entry) => entry.name !== "node_modules")
        .map((entry) => join(directory, entry.name));
    });
  }
  return directories;
}

/** Workspace members with a package name, the same walk as nx-sync-codemod.mjs. */
function members() {
  const globs = [];
  let inside = false;
  for (const line of read(join(root, "pnpm-workspace.yaml")).split("\n")) {
    if (/^packages:\s*$/.test(line)) inside = true;
    else if (inside && /^\S/.test(line)) break;
    const entry = inside && /^\s+-\s+["']?([^"'#\s]+)["']?\s*$/.exec(line);
    if (entry) globs.push(entry[1]);
  }
  return globs
    .flatMap((glob) => expand(glob))
    .filter((directory) => existsSync(join(root, directory, "package.json")))
    .filter((directory) => Boolean(readConfig(join(root, directory, "package.json")).name))
    .toSorted();
}

const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
const parsedFile = (file) => ts.getParsedCommandLineOfConfigFile(file, {}, host);
/** The files a config would compile if its raw JSON were `raw`. */
function filesOf({ raw, file }) {
  const result = ts.parseJsonConfigFileContent(raw, ts.sys, dirname(file), undefined, file);
  return new Set(result.fileNames.map((name) => resolve(name)));
}

/** The part of one include glob that one build exclude glob selects, as include globs. */
function intersect({ include, exclude }) {
  if (!include.includes("*")) return [];
  const at = include.lastIndexOf("/**/");
  if (at < 0) return undefined;
  const prefix = include.slice(0, at);
  const leaf = include.slice(at + 4);
  if (!/^\*(?:\.[\w.]+)?$/.test(leaf)) return undefined;
  const extension = leaf.slice(1);
  const directory = /^(?:[\w.-]+\/)*\*\*\/([\w.-]+)\/\*\*$/.exec(exclude);
  if (directory) return [`${prefix}/**/${directory[1]}/**/${leaf}`];
  const name = /^(?:[\w.-]+\/)*\*\*\/([\w.*-]+)$/.exec(exclude)?.[1];
  if (!name) return undefined;
  if (extension === "") return [`${prefix}/**/${name}`];
  if (name.endsWith(".*")) {
    const base = name.slice(0, -2);
    return [`${prefix}/**/${base}${extension}`, `${prefix}/**/${base}.*${extension}`];
  }
  return name.endsWith(extension) ? [`${prefix}/**/${name}`] : [];
}

/** Step 1: the test config checks only what the build config excludes. */
function narrowTestConfig({ directory, buildFiles, buildRaw }) {
  const file = join(root, directory, "tsconfig.test.json");
  if (!existsSync(file)) return new Set();
  const raw = readConfig(file);
  const before = filesOf({ raw, file });
  // Ambient declarations (`*.d.ts`) stay in both programs: a reference does not carry them.
  const ambient = (name) => name.endsWith(".d.ts");
  const target = new Set([...before].filter((name) => !buildFiles.has(name) || ambient(name)));
  const include = [];
  for (const glob of raw.include ?? []) {
    const own = filesOf({ raw: { ...raw, include: [glob], files: undefined }, file });
    if (![...own].some((name) => buildFiles.has(name))) {
      include.push(glob);
      continue;
    }
    const parts = (buildRaw.exclude ?? []).map((exclude) => intersect({ include: glob, exclude }));
    if (parts.some((part) => part === undefined)) {
      problems.push(`${directory}: cannot narrow include ${glob}`);
      return target;
    }
    include.push(...parts.flat());
    include.push(...[...own].filter(ambient).map((name) => relative(join(root, directory), name)));
  }
  const unique = [...new Set(include)];
  const overlap = filesOf({ raw: { ...raw, include: unique }, file });
  const shared = [...overlap].filter((name) => buildFiles.has(name) && !ambient(name));
  const exclude = [
    ...(raw.exclude ?? []),
    ...shared.map((name) => relative(join(root, directory), name)),
  ];
  const next = { ...raw, include: unique, exclude };
  if (unique.length === 0) next.files = [];
  const after = filesOf({ raw: next, file });
  const same = after.size === target.size && [...after].every((name) => target.has(name));
  if (!same) {
    problems.push(
      `${directory}: narrowed test config would check a different file set: +${[...after].filter((n) => !target.has(n)).join(",")} -${[...target].filter((n) => !after.has(n)).join(",")}`,
    );
    return target;
  }
  if (JSON.stringify(raw.include) === JSON.stringify(unique) && shared.length === 0) return target;
  let text = read(file);
  text = edit({ text, path: ["include"], value: unique });
  text = edit({ text, path: ["exclude"], value: exclude.length > 0 ? exclude : undefined });
  if (unique.length === 0) text = edit({ text, path: ["files"], value: [] });
  if (write({ file, text })) counts.testConfigs += 1;
  return target;
}

const workspaceDeps = (manifest) =>
  ["dependencies", "devDependencies"].flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([, version]) => String(version).startsWith("workspace:"))
      .map(([name]) => ({ name, field })),
  );

function uses({ text, name }) {
  const quoted = `["'\`]${escape(name)}(?:["'\`]|/)`;
  const call =
    "(?:\\bfrom|\\bimport|\\brequire|\\bmock|\\bdoMock|\\bimportActual|\\brequireActual|\\bmodule|types=)";
  return new RegExp(`${call}\\s*\\(?\\s*(?:<[^>]*>\\s*\\(\\s*)?${quoted}`).test(text);
}

/** Step 2: deps no source or test file imports go in nx.sync.ignoredDependencies. Test
 * imports keep theirs: the test config references only the build config (ADR-150). */
function ignoreUnimported({ directory, buildFiles, testFiles, manifest, projects }) {
  const file = join(root, directory, "tsconfig.build.json");
  const types = parsedFile(file)?.options.types ?? [];
  const texts = [...buildFiles, ...testFiles]
    .filter((name) => existsSync(name))
    .map((name) => read(name));
  const derived = workspaceDeps(manifest)
    .map(({ name }) => name)
    .filter((name) => projects.has(name) && name !== manifest.name)
    .filter((name) => !types.includes(name) && !texts.some((text) => uses({ text, name })));
  const ignored = [...new Set([...(HAND_IGNORED[directory] ?? []), ...derived])].toSorted(byName);
  let text = read(file);
  const raw = readConfig(file);
  const current = raw.nx?.sync?.ignoredDependencies ?? [];
  if (JSON.stringify(current) === JSON.stringify(ignored)) return;
  const lines = text.split("\n").filter((line) => line.trim() !== MARKER);
  text = lines.join("\n");
  if (ignored.length === 0) {
    text = edit({ text, path: ["nx"], value: undefined });
  } else {
    text = edit({ text, path: ["nx", "sync", "ignoredDependencies"], value: ignored });
    if (derived.length > 0)
      text = text.replace(/^(\s*)"nx": \{/m, (line, indent) => `${indent}${MARKER}\n${line}`);
  }
  if (write({ file, text })) counts.ignoreConfigs += 1;
}

/** The files the package-dependencies policy reads (architecture-enforcer manifests.ts). */
function walk(directory, top = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (UNSCANNED_DIRS.has(entry.name)) return [];
      if (existsSync(join(path, "package.json"))) return [];
      return walk(path, top);
    }
    const rootJson = directory === top && entry.name.endsWith(".json");
    return READ_FILE.test(entry.name) || (rootJson && entry.name !== "package.json") ? [path] : [];
  });
}

// The policy's test split: what the build configs exclude never ships.
const TEST_DIRECTORY = /^(?:__tests__|__mocks__|__bench__|tests)$/;
const TEST_FILE = /\.(?:test|spec|stories|bench)\.|^testing\.tsx?$|^vitest\.config\./;
const isTest = ({ directory, path }) =>
  relative(directory, path)
    .split("/")
    .slice(0, -1)
    .some((folder) => TEST_DIRECTORY.test(folder)) || TEST_FILE.test(basename(path));

const byName = (left, right) => left.localeCompare(right);
const sorted = (map) =>
  Object.fromEntries(Object.entries(map).toSorted(([left], [right]) => byName(left, right)));

/** Every package name the package's files quote, split as the policy splits them. */
function namesUsed({ directory }) {
  const source = new Set();
  const test = new Set();
  for (const path of walk(join(root, directory))) {
    const names = isTest({ directory: join(root, directory), path }) ? test : source;
    for (const match of read(path).matchAll(/["'`]((?:@[\w.-]+\/)?[\w.-]+)(?=["'`/])/g))
      names.add(match[1]);
  }
  return { source, test };
}

/** What becomes of one workspace dependency: kept, moved to dev, or removed. */
function verdict({ name, field, used, scripts }) {
  if (used.source.has(name)) return "keep";
  if (scripts.includes(name.replace(/^@[^/]+\//, ""))) return "keep";
  if (!used.test.has(name)) return "remove";
  return field === "devDependencies" ? "keep" : "move";
}

/** Step 3: workspace deps nothing names go; runtime ones only tests name become dev. */
function pruneDependencies({ directory, manifest }) {
  const used = namesUsed({ directory });
  const scripts = Object.values(manifest.scripts ?? {}).join("\n");
  const next = {
    ...manifest,
    dependencies: { ...manifest.dependencies },
    devDependencies: { ...manifest.devDependencies },
  };
  for (const { name, field } of workspaceDeps(manifest)) {
    const outcome = verdict({ name, field, used, scripts });
    if (outcome === "keep") continue;
    delete next[field][name];
    if (outcome === "move") next.devDependencies[name] = manifest.dependencies[name];
    counts[outcome === "move" ? "moved" : "removed"] += 1;
  }
  for (const field of ["dependencies", "devDependencies"]) {
    next[field] = sorted(next[field]);
    if (Object.keys(next[field]).length === 0) delete next[field];
  }
  write({
    file: join(root, directory, "package.json"),
    text: `${JSON.stringify(next, null, 2)}\n`,
  });
}

const all = members();
const projects = new Set(
  all
    .filter((directory) => existsSync(join(root, directory, "tsconfig.json")))
    .map((directory) => readConfig(join(root, directory, "package.json")).name),
);
const asked = process.argv.slice(2).map((path) => relative(root, resolve(path)));
const directories = all
  .filter((directory) => asked.length === 0 || asked.includes(directory))
  .filter(
    (directory) => !SKIPPED.some((skip) => directory === skip || directory.startsWith(`${skip}/`)),
  );

for (const directory of directories) {
  const buildFile = join(root, directory, "tsconfig.build.json");
  const manifest = readConfig(join(root, directory, "package.json"));
  if (existsSync(buildFile)) {
    const buildRaw = readConfig(buildFile);
    const buildFiles = filesOf({ raw: buildRaw, file: buildFile });
    const testFiles = narrowTestConfig({ directory, buildFiles, buildRaw });
    ignoreUnimported({ directory, buildFiles, testFiles, manifest, projects });
  }
  pruneDependencies({ directory, manifest });
}

for (const file of [...written].toSorted(byName)) console.log(file);
console.error(
  `${directories.length} packages: ${counts.testConfigs} test configs narrowed, ` +
    `${counts.ignoreConfigs} build configs re-ignored, ${counts.removed} deps removed, ` +
    `${counts.moved} deps moved to devDependencies.`,
);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
