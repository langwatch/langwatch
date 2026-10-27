#!/usr/bin/env node
// Reshapes every workspace package's tsconfigs into the layout `nx sync` maintains
// (@nx/js:typescript-sync; ADR-150's 2026-10-10 amendment). Idempotent: a package whose
// tsconfig.json is already a container is left alone, so it can run again after a merge.
// Usage: node dev/scripts/nx-sync-codemod.mjs, then `pnpm sync:references` (nx sync).
// It prints every file it wrote and fails if a package lost a file from its checks.

import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// TypeScript 6's config API and jsonc-parser, from @nx/js's own dependency closure.
const fromNx = createRequire(createRequire(join(root, "package.json")).resolve("@nx/js"));
const ts = fromNx("typescript");
const jsonc = fromNx("jsonc-parser");

const LOCATIONS = ["files", "include", "exclude"];
const EXTRA_CHECKS = ["tsconfig.type-tests.json", "tsconfig.tests.json"];
const GROUP = "dev/tsconfig.web-declarations.json";
// Options a check config sets differently from the check root it replaces, by design.
const CHECK_DELTA = ["composite", "noEmit", "tsBuildInfoFile", "declaration"];
const written = new Set();

const read = (file) => readFileSync(file, "utf8");
const parse = (text) => jsonc.parse(text, [], { allowTrailingComma: true }) ?? {};
const readConfig = (file) => parse(read(file));

function edit({ text, path, value, before }) {
  const formattingOptions = { insertSpaces: true, tabSize: 2 };
  const getInsertionIndex = before ? (keys) => Math.max(keys.indexOf(before), 0) : undefined;
  return jsonc.applyEdits(
    text,
    jsonc.modify(text, path, value, { formattingOptions, getInsertionIndex }),
  );
}

function retire(file) {
  if (!existsSync(join(root, file))) return;
  rmSync(join(root, file));
  written.add(`${file} (deleted)`);
}

function write({ file, text }) {
  const body = text.endsWith("\n") ? text : `${text}\n`;
  if (existsSync(file) && read(file) === body) return;
  writeFileSync(file, body);
  written.add(relative(root, file));
}

function expand(glob) {
  let directories = [""];
  for (const segment of glob.split("/")) {
    directories = directories.flatMap((directory) => {
      if (segment !== "*")
        return existsSync(join(root, directory, segment)) ? [join(directory, segment)] : [];
      return readdirSync(join(root, directory), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
        )
        .map((entry) => join(directory, entry.name));
    });
  }
  return directories;
}

/** Workspace members with a tsconfig.json: every one of them is an Nx project the sync rewrites. */
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
    .filter((directory) => existsSync(join(root, directory, "tsconfig.json")))
    .filter((directory) => existsSync(join(root, directory, "package.json")))
    .filter((directory) => Boolean(readConfig(join(root, directory, "package.json")).name))
    .toSorted();
}

const configNames = (directory) =>
  readdirSync(join(root, directory)).filter((name) => /^tsconfig(\..+)?\.json$/.test(name));

function parsed(file) {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  const result = ts.getParsedCommandLineOfConfigFile(file, {}, host);
  const options = { ...result?.options };
  delete options.configFilePath;
  return { fileNames: result?.fileNames ?? [], options };
}

/** Each config of a package, what it compiles and with which options: the before/after check. */
function snapshot(directory) {
  const names = [
    ...configNames(directory),
    ...(directory === "packages/mail" ? ["preview/tsconfig.json"] : []),
  ];
  return new Map(names.map((name) => [name, parsed(join(root, directory, name))]));
}

const isContainer = (config) =>
  Array.isArray(config.files) &&
  config.files.length === 0 &&
  Array.isArray(config.include) &&
  config.include.length === 0;
const extendsContainer = (config) => [config.extends ?? []].flat().includes("./tsconfig.json");

/** The cyclic web group is vestigial (plan §2): each member becomes an ordinary producer. */
function dissolveGroup() {
  const group = join(root, GROUP);
  if (!existsSync(group)) return;
  for (const { directory } of readConfig(group).langwatchDeclarationGroup.members) {
    const member = resolve(dirname(group), directory);
    const entry = readConfig(join(member, "package.json")).exports["./declaration"].default;
    // Ambient declarations outside src (experiment's types/) that the group got from its types.
    const ambient = (readConfig(join(member, "tsconfig.json")).include ?? []).filter(
      (glob) => glob.endsWith(".d.ts") && !glob.startsWith("src/"),
    );
    // The shape of modules/agent/browser/tsconfig.build.json, the non-group exemplar.
    const build = {
      compilerOptions: {
        outDir: "dist",
        rootDir: "src",
        tsBuildInfoFile: "dist/tsconfig.build.tsbuildinfo",
      },
      extends: ["./tsconfig.json", "../../../tsconfig.emit.json"],
      files: [entry],
      include: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.json", ...ambient],
      exclude: [
        "**/__tests__/**",
        "**/__mocks__/**",
        "**/tests/**",
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.stories.*",
        "**/*.bench.*",
        "**/__bench__/**",
        "**/testing.ts",
        "**/testing.tsx",
      ],
      references: [],
    };
    write({ file: join(member, "tsconfig.build.json"), text: JSON.stringify(build, null, 2) });
  }
  retire(GROUP);
}

/**
 * tsconfig.build.json is the declaration producer everywhere: a build config that emits
 * JavaScript instead (mail, langyworker) moves to tsconfig.js.json, and mail's declaration
 * config takes the name.
 */
function moveJavascriptBuilds(directories) {
  for (const directory of directories) {
    const at = (name) => join(root, directory, name);
    if (!existsSync(at("tsconfig.build.json"))) continue;
    if (readConfig(at("tsconfig.build.json")).compilerOptions?.declaration !== false) continue;
    const javascript = read(at("tsconfig.build.json")).replace(
      /\/\/ Declaration preparation uses .*\n\s*\/\/ this config emits .*\n/,
      "// tsconfig.build.json emits the declarations (dist/typecheck); this config\n  // emits the JavaScript the server processes load (`pnpm build`).\n",
    );
    write({ file: at("tsconfig.js.json"), text: javascript });
    retire(join(directory, "tsconfig.build.json"));
    if (existsSync(at("tsconfig.declarations.json"))) {
      renameSync(at("tsconfig.declarations.json"), at("tsconfig.build.json"));
      written.add(join(directory, "tsconfig.build.json"));
    }
    const manifest = read(at("package.json"));
    write({
      file: at("package.json"),
      text: manifest.replaceAll("tsc -p tsconfig.build.json", "tsc -p tsconfig.js.json"),
    });
  }
  // The mail studio imports only @langwatch/mail and design-system-internal; the rest was stale.
  const preview = join(root, "packages/mail/preview/tsconfig.json");
  const references = ["../tsconfig.build.json", "../../design-system-internal/tsconfig.build.json"];
  write({
    file: preview,
    text: edit({
      text: read(preview),
      path: ["references"],
      value: references.map((path) => ({ path })),
    }),
  });
}

function typecheckScript(script) {
  if (script === undefined) return "tsc -b";
  return script.replace(/(^|&& )tsc (?:-b(?: [\w./-]+)*|--noEmit)$/, "$1tsc -b");
}

/** The package's own check is the container: `tsc -b` builds its build and its checks. */
function retarget(directory) {
  const file = join(root, directory, "package.json");
  const script = typecheckScript(readConfig(file).scripts?.typecheck);
  write({ file, text: edit({ text: read(file), path: ["scripts", "typecheck"], value: script }) });
}

/** One inner config: what it inherited from the old tsconfig.json, build info, references. */
function innerConfig({ directory, name, container, producer, checks }) {
  const file = join(root, directory, name);
  let text = read(file);
  const config = parse(text);
  for (const key of LOCATIONS) {
    if (!(key in config) && key in container)
      text = edit({ text, path: [key], value: container[key] });
  }
  if (name === "tsconfig.build.json") return write({ file, text });
  const options = config.compilerOptions ?? {};
  const stem = name.slice("tsconfig.".length, -".json".length);
  const buildInfo = `dist/tsconfig.${stem}.tsbuildinfo`;
  const renamed =
    stem === "app" && (options.tsBuildInfoFile ?? "").endsWith("tsconfig.test.tsbuildinfo");
  if (options.composite === undefined)
    text = edit({ text, path: ["compilerOptions", "composite"], value: false });
  if (options.noEmit === undefined)
    text = edit({ text, path: ["compilerOptions", "noEmit"], value: true });
  if (!options.tsBuildInfoFile || renamed) {
    text = edit({ text, path: ["compilerOptions", "tsBuildInfoFile"], value: buildInfo });
  }
  if (checks.includes(name)) {
    const references = producer ? [{ path: "./tsconfig.build.json" }] : [];
    text = edit({ text, path: ["references"], value: references });
  }
  write({ file, text });
}

function convert({ directory, extras }) {
  const at = (name) => join(root, directory, name);
  const containerText = read(at("tsconfig.json"));
  const container = parse(containerText);
  if (isContainer(container)) return;
  const producer = existsSync(at("tsconfig.build.json"));
  const check = producer ? "tsconfig.test.json" : "tsconfig.app.json";
  if (!producer && existsSync(at("tsconfig.test.json")))
    renameSync(at("tsconfig.test.json"), at(check));
  if (!existsSync(at(check)))
    write({
      file: at(check),
      text: '{\n  "extends": "./tsconfig.json",\n  "compilerOptions": {}\n}\n',
    });
  const extraChecks = EXTRA_CHECKS.filter((name) => existsSync(at(name)));
  if (!producer && extraChecks.length > 0)
    throw new Error(`${directory}: extra check configs need a producer`);
  const checks = [check, ...extraChecks];
  const inner = configNames(directory)
    .filter((name) => name !== "tsconfig.json")
    .filter((name) => extendsContainer(readConfig(at(name))));
  for (const name of inner) innerConfig({ directory, name, container, producer, checks });
  let text = containerText;
  for (const key of ["files", "exclude"]) text = edit({ text, path: [key], value: undefined });
  text = edit({ text, path: ["include"], value: [] });
  text = edit({ text, path: ["files"], value: [], before: "include" });
  text = edit({ text, path: ["compilerOptions", "composite"], value: true });
  text = edit({ text, path: ["compilerOptions", "noEmit"], value: false });
  const own = [
    ...(producer ? ["./tsconfig.build.json"] : []),
    ...checks.map((n) => `./${n}`),
    ...extras,
  ];
  text = edit({ text, path: ["references"], value: own.map((path) => ({ path })) });
  write({ file: at("tsconfig.json"), text });
  retarget(directory);
}

const ROOT_SOLUTION = `{
  // The workspace solution: \`pnpm typecheck\` runs one \`tsc -b\` over every package's
  // container tsconfig.json, so each project is checked once (ADR-150, 2026-10-10).
  // \`references\` is written by \`pnpm sync:references\` (\`nx sync\`, @nx/js:typescript-sync)
  // from the Nx project graph, and \`nx sync:check\` fails CI when it drifts. Do not hand-edit it.
  "files": [],
  "exclude": [".claude/"],
  "references": []
}
`;

function rewriteRoot(directories) {
  const references = directories.map((directory) => ({ path: `./${directory}` }));
  write({
    file: join(root, "tsconfig.json"),
    text: edit({ text: ROOT_SOLUTION, path: ["references"], value: references }),
  });
  // The generated build solution: `build:types` now globs the contract build configs.
  retire("tsconfig.build.json");
  retire("dev/tsconfig.declarations.json");
}

const sameOptions = ({ left, right, ignore }) => {
  const strip = (options) =>
    JSON.stringify(
      Object.entries(options)
        .filter(([key]) => !ignore.includes(key))
        .toSorted(),
    );
  return strip(left) === strip(right);
};

/** What each package compiled before and after, and with which options: nothing may be lost. */
function verify({ directory, before }) {
  const after = snapshot(directory);
  const union = (configs) => new Set([...configs.values()].flatMap((config) => config.fileNames));
  const kept = union(after);
  const lost = [...union(before)]
    .filter((file) => !kept.has(file))
    .map((file) => relative(root, file));
  const problems =
    lost.length > 0 ? [`lost ${lost.length} file(s), e.g. ${lost.slice(0, 3).join(", ")}`] : [];
  const pairs = [
    [
      "tsconfig.build.json",
      before.has("tsconfig.declarations.json")
        ? "tsconfig.declarations.json"
        : "tsconfig.build.json",
      [],
    ],
    [
      after.has("tsconfig.app.json") ? "tsconfig.app.json" : "tsconfig.test.json",
      before.has("tsconfig.test.json") ? "tsconfig.test.json" : "tsconfig.json",
      CHECK_DELTA,
    ],
    ...EXTRA_CHECKS.map((name) => [name, name, CHECK_DELTA]),
    ...(before.get("tsconfig.build.json")?.options.declaration === false
      ? [["tsconfig.js.json", "tsconfig.build.json", ["composite"]]]
      : []),
  ];
  for (const [now, then, ignore] of pairs) {
    const [left, right] = [after.get(now), before.get(then)];
    if (!left || !right || before.get(then).fileNames.length === 0) continue;
    if (!sameOptions({ left: left.options, right: right.options, ignore }))
      problems.push(`${now} options differ from ${then}`);
  }
  return problems.map((problem) => `${directory}: ${problem}`);
}

const directories = members();
const before = new Map(directories.map((directory) => [directory, snapshot(directory)]));
const extrasOf = (directory) =>
  (readConfig(join(root, "tsconfig.json")).langwatchExtraReferences ?? [])
    .map(({ path }) => path)
    .filter((path) => path.startsWith(`${directory}/`))
    .map((path) => `./${path.slice(directory.length + 1)}`);
const extras = new Map(directories.map((directory) => [directory, extrasOf(directory)]));

dissolveGroup();
moveJavascriptBuilds(directories);
for (const directory of directories) convert({ directory, extras: extras.get(directory) });
rewriteRoot(directories);

const problems = directories.flatMap((directory) =>
  verify({ directory, before: before.get(directory) }),
);
for (const file of [...written].toSorted()) console.log(file);
console.error(`${written.size} files written over ${directories.length} packages.`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
