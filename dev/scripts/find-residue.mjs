#!/usr/bin/env node
/**
 * Finds residue: code kept alive only because nothing forces its deletion
 * (see `.claude/skills/residue/SKILL.md`). Reads specifiers, not types, so
 * a string-only reference reads as an orphan — leads, not a delete list.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;
const byCodeUnit = (a, b) => (a < b ? -1 : Number(a > b));
const DETECTORS = ["orphan", "test-only", "re-export", "twin", "slack-ratchet", "dangling-guard"];
/**
 * Files a tool finds by glob rather than by import: stories, fixtures,
 * mocks. Storybook's CSF convention means every story exports `Default`,
 * `Sizes` and `Disabled` — a naming convention, not a "twin" finding.
 */
const DISCOVERED =
  /\.stories\.[cm]?[jt]sx?$|(^|\/)\.storybook\/|(^|\/)__(?:fixtures|mocks|snapshots)__\//;

// --- reading -----------------------------------------------------------------

const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/**
 * Blanks line/block comments so a specifier inside a doc example isn't read
 * as an edge, preserving line count — deleting newlines here would shift
 * every later finding's reported line number.
 */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_match, prefix) => prefix);

/**
 * Every module specifier the file names: static import, `export ... from`,
 * and dynamic `import()`.
 */
export const specifiersIn = (text) => {
  const source = stripComments(text);
  const found = [];
  const patterns = [
    /\bimport\s+[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return [...new Set(found)];
};

/** Exported declaration names, by line. Re-exports are excluded: they declare nothing. */
export const declarationsIn = (text) => {
  const source = stripComments(text);
  const found = [];
  const lines = source.split("\n");
  const pattern =
    /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:default\s+)?(?:async\s+)?(?:class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)/;
  lines.forEach((line, index) => {
    const match = pattern.exec(line);
    if (match) found.push({ name: match[1], line: index + 1 });
  });
  return found;
};

// --- the workspace -----------------------------------------------------------

const listSourceFiles = (target) => {
  const tracked = execSync("git ls-files", { encoding: "utf8", maxBuffer: 1 << 28 })
    .trim()
    .split("\n")
    .filter((file) => SOURCE.test(file) && !/(^|\/)(node_modules|dist|build)\//.test(file));
  if (!target) return tracked;
  const prefix = relative(ROOT, resolve(target)).split("\\").join("/");
  return tracked.filter((file) => file === prefix || file.startsWith(`${prefix}/`));
};

const packageDirs = () =>
  execSync("git ls-files '*/package.json' package.json", { encoding: "utf8", maxBuffer: 1 << 26 })
    .trim()
    .split("\n")
    .filter((file) => file && !/(^|\/)node_modules\//.test(file))
    .map((file) => (dirname(file) === "." ? "" : dirname(file)));

const exportTargets = (exportsField) =>
  Object.entries(exportsField ?? {}).flatMap(([subpath, value]) =>
    typeof value === "string"
      ? [[subpath, value]]
      : Object.values(value ?? {}).map((nested) => [subpath, nested]),
  );

/**
 * name -> { dir, entries: Map<subpath, file> } for every workspace
 * package, plus its declared roots.
 */
/** Every `exports`/`main`/`bin` target a manifest declares, as raw repo-relative specs. */
const manifestEntries = ({ dir, manifest }) => {
  const entries = new Map();
  const specs = new Set();
  const add = (subpath, target) => {
    if (typeof target !== "string" || !target.startsWith(".")) return;
    const file = join(dir, target).split("\\").join("/");
    if (subpath !== null) entries.set(subpath, file);
    specs.add(file);
  };

  add(".", manifest.main);
  add(".", manifest.module);
  for (const [subpath, target] of exportTargets(manifest.exports)) add(subpath, target);
  if (typeof manifest.bin === "string") add(null, manifest.bin);
  else for (const value of Object.values(manifest.bin ?? {})) add(null, value);

  // A path named in a script is a root: that is how entrypoints are launched.
  for (const script of Object.values(manifest.scripts ?? {})) {
    for (const match of String(script).matchAll(
      /(?:^|\s)((?:\.\/)?(?:src|scripts)\/[\w./-]+\.[cm]?[jt]sx?)/g,
    )) {
      specs.add(join(dir, match[1]).split("\\").join("/"));
    }
  }

  return { entries, specs };
};

const parseManifest = (dir) => {
  try {
    const manifest = JSON.parse(read(join(ROOT, dir, "package.json")));
    return manifest?.name ? manifest : null;
  } catch {
    return null;
  }
};

/** name -> { dir, entries } for every workspace package, plus every declared root spec. */
const readWorkspace = () => {
  const byName = new Map();
  const rootSpecs = new Set();

  for (const dir of packageDirs()) {
    const manifest = parseManifest(dir);
    if (!manifest) continue;
    const { entries, specs } = manifestEntries({ dir, manifest });
    for (const spec of specs) rootSpecs.add(spec);
    byName.set(manifest.name, { dir, entries });
  }

  return { byName, rootSpecs, roots: new Set() };
};

/**
 * Turns declared entries into files that exist: a package's `exports` may
 * point at built output (`./dist/x/index.d.ts`), which must map back to
 * `src/x/index.ts` or the whole SDK reads as unreachable.
 */
export const resolveRoots = ({ rootSpecs, known }) => {
  const roots = new Set();
  const candidates = (base) =>
    CANDIDATE_SUFFIXES.map((suffix) => `${base}${suffix}`.split("\\").join("/"));
  for (const spec of rootSpecs) {
    const normalised = spec.replace(/^\.\//, "");
    const stripped = normalised.replace(/\.d\.ts$|\.[cm]?jsx?$/, "");
    const forms = [normalised, stripped, stripped.replace(/(^|\/)dist\//, "$1src/")];
    for (const form of forms) {
      const hit = candidates(form).find((candidate) => known.has(candidate));
      if (hit) {
        roots.add(hit);
        break;
      }
    }
  }
  return roots;
};

const REFERENCING_FILE = /(?:^|\/)(?:Makefile[\w.-]*|Dockerfile[\w.-]*)$|\.(?:ya?ml|sh|toml)$/;

/**
 * Source files named from something that is not source: a workflow step, a
 * Makefile target, a shell script. Nothing imports `.github/scripts/guard-*.ts`
 * — CI runs it by path — so without this every one of them reads as residue.
 */
export const findReferencedRoots = ({ known, readFile = read }) => {
  const roots = new Set();
  const referencing = execSync("git ls-files", { encoding: "utf8", maxBuffer: 1 << 28 })
    .trim()
    .split("\n")
    .filter(
      (file) =>
        REFERENCING_FILE.test(file) &&
        !/(^|\/)(node_modules|dist)\//.test(file) &&
        !/lock\.ya?ml$/.test(file),
    );
  for (const file of referencing) {
    const text = readFile(join(ROOT, file));
    if (!text) continue;
    for (const match of text.matchAll(/[\w@./-]+\.[cm]?[jt]sx?\b/g)) {
      const raw = match[0].replace(/^\.\//, "");
      if (known.has(raw)) {
        roots.add(raw);
        continue;
      }
      // A path written relative to the file that names it.
      const relativeToFile = join(dirname(file), raw).split("\\").join("/");
      if (known.has(relativeToFile)) roots.add(relativeToFile);
    }
  }
  return roots;
};

const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

/** Resolves one specifier to a repository-relative file, or null when it leaves the workspace. */
const resolveSpecifier = ({ specifier, fromFile, workspace, known }) => {
  const attempt = (base) => {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = `${base}${suffix}`.split("\\").join("/");
      if (known.has(candidate)) return candidate;
    }
    // `./x.ts` written for a file the loader resolves as `./x.ts` directly.
    const rewritten = base
      .replace(/\.[cm]?js$/, ".ts")
      .split("\\")
      .join("/");
    return known.has(rewritten) ? rewritten : null;
  };

  if (specifier.startsWith(".")) {
    return attempt(join(dirname(fromFile), specifier));
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const pkg = workspace.byName.get(name);
  if (!pkg) return null;
  const subpath = specifier === name ? "." : `./${specifier.slice(name.length + 1)}`;
  const declared = pkg.entries.get(subpath) ?? pkg.entries.get(".");
  if (subpath !== "." && !pkg.entries.has(subpath)) {
    // No exports map entry: fall back to the path as written under the package.
    const direct = attempt(join(pkg.dir, subpath));
    if (direct) return direct;
  }
  return declared ?? null;
};

/** Forward and reverse import graphs over every tracked source file. */
export const buildGraph = ({ files, workspace, readFile = read }) => {
  const known = new Set(files);
  const imports = new Map();
  const importedBy = new Map();
  for (const file of files) {
    imports.set(file, new Set());
    if (!importedBy.has(file)) importedBy.set(file, new Set());
  }
  for (const file of files) {
    for (const specifier of specifiersIn(readFile(join(ROOT, file)))) {
      const target = resolveSpecifier({ specifier, fromFile: file, workspace, known });
      if (!target || target === file) continue;
      imports.get(file).add(target);
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target).add(file);
    }
  }
  return { imports, importedBy };
};

const reachableFrom = ({ seeds, imports }) => {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of imports.get(file) ?? []) if (!seen.has(next)) queue.push(next);
  }
  return seen;
};

const packageOf = (file, workspace) => {
  let best = "";
  for (const { dir } of workspace.byName.values()) {
    if (dir === "") continue;
    if ((file === dir || file.startsWith(`${dir}/`)) && dir.length > best.length) best = dir;
  }
  return best;
};

// --- detectors ---------------------------------------------------------------

/**
 * A file the loader reaches without anyone importing it: entrypoints,
 * configs, and declared roots.
 */
const isDeclaredRoot = (file, workspace) =>
  workspace.roots.has(file) ||
  /(^|\/)[\w.-]*\.config\.[cm]?[jt]s$/.test(file) ||
  /\.entrypoint(\.main)?\.[cm]?tsx?$/.test(file) ||
  (/(^|\/)(index|main)\.[cm]?tsx?$/.test(file) && workspace.roots.has(file)) ||
  /(^|\/)(migrations|seeds)\//.test(file) ||
  DISCOVERED.test(file) ||
  file.endsWith(".d.ts");

export const findGraphResidue = ({ files, workspace, graph }) => {
  const { imports, importedBy } = graph;
  const tests = files.filter((file) => TEST.test(file));
  const prodSeeds = files.filter((file) => !TEST.test(file) && isDeclaredRoot(file, workspace));
  const live = reachableFrom({ seeds: prodSeeds, imports });
  const underTest = reachableFrom({ seeds: tests, imports });

  const findings = [];
  for (const file of files) {
    if (TEST.test(file)) continue;
    if (isDeclaredRoot(file, workspace)) continue;
    if (live.has(file)) continue;
    const importers = [...(importedBy.get(file) ?? [])];
    if (underTest.has(file)) {
      const owning = importers.filter((importer) => TEST.test(importer));
      findings.push({
        detector: "test-only",
        file,
        line: 1,
        detail: `reachable only from tests (${owning.length > 0 ? owning.join(", ") : "transitively"})`,
      });
      continue;
    }
    findings.push({
      detector: "orphan",
      file,
      line: 1,
      detail:
        importers.length === 0
          ? "nothing imports it"
          : `imported only by unreachable files (${importers.length})`,
    });
  }
  return findings;
};

/**
 * The first `export ... from "./sibling"` line, or null. Bare-package
 * re-exports are a package's own business.
 */
export const reExportSites = (text) => {
  const source = stripComments(text);
  const sites = [];
  // Statement-scoped, not line-scoped: the closing brace of a multi-line
  // `import { ... } from "./x"` looks exactly like a re-export to a line regex,
  // and reading it that way is what made the first run report nine phantoms.
  const patterns = [
    /\bexport\s+(?:type\s+)?\{[^{}]*\}\s*from\s*["'](\.\.?\/[^"']+)["']/g,
    /\bexport\s+\*(?:\s+as\s+[\w$]+)?\s+from\s*["'](\.\.?\/[^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      sites.push(source.slice(0, match.index).split("\n").length);
    }
  }
  return [...new Set(sites)].toSorted((left, right) => left - right);
};

export const findReExportShims = ({ files, workspace, readFile = read }) =>
  files
    .filter((file) => !TEST.test(file))
    // A package's declared entry re-exports by design: that is its public surface.
    .filter((file) => !workspace.roots.has(file) && !/(^|\/)index\.[cm]?tsx?$/.test(file))
    .flatMap((file) => {
      const text = readFile(join(ROOT, file));
      const sites = reExportSites(text);
      if (sites.length === 0) return [];
      const pure = declarationsIn(text).length === 0;
      return [
        {
          detector: "re-export",
          file,
          line: sites[0],
          detail: pure
            ? `forwards ${sites.length} line${sites.length === 1 ? "" : "s"} and declares nothing: a shim left at the old address`
            : `declares its own names and also forwards ${sites.length} line${sites.length === 1 ? "" : "s"} from a sibling: a half-finished move`,
        },
      ];
    });

/**
 * name -> the files a package entry re-exports it from. A barrel is the package's
 * public surface, so a name published from one file and merely declared in
 * another is the shape a half-finished move leaves behind.
 */
const NAMED_FORWARD = /\bexport\s+(?:type\s+)?\{([^{}]*)\}\s*from\s*["'](\.\.?\/[^"']+)["']/g;
const STAR_FORWARD = /\bexport\s+\*\s+from\s*["'](\.\.?\/[^"']+)["']/g;

const forwardTarget = ({ specifier, barrel, known }) =>
  resolveSpecifier({ specifier, fromFile: barrel, workspace: { byName: new Map() }, known });

/** `A, type B as C` -> ["A", "B"]: the names as the source module declares them. */
const forwardedNames = (clause) =>
  clause
    .split(",")
    .map((piece) =>
      piece
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim(),
    )
    .filter(Boolean);

/**
 * name -> the files a package entry re-exports it from. A barrel is the package's
 * public surface, so a name published from one file and merely declared in
 * another is the shape a half-finished move leaves behind.
 */
export const readPublicSurface = ({ roots, known, readFile = read }) => {
  const surface = new Map();
  for (const barrel of roots) {
    const text = stripComments(readFile(join(ROOT, barrel)));
    recordForwards({ surface, text, barrel, known });
  }
  return surface;
};

const recordPublished = ({ surface, file, name }) => {
  if (!surface.has(file)) surface.set(file, new Set());
  surface.get(file).add(name);
};

/** Records every name one barrel forwards, against the file it forwards from. */
const recordForwards = ({ surface, text, barrel, known }) => {
  for (const match of text.matchAll(NAMED_FORWARD)) {
    const file = forwardTarget({ specifier: match[2], barrel, known });
    if (!file) continue;
    for (const name of forwardedNames(match[1])) recordPublished({ surface, file, name });
  }
  for (const match of text.matchAll(STAR_FORWARD)) {
    const file = forwardTarget({ specifier: match[1], barrel, known });
    if (file) recordPublished({ surface, file, name: "*" });
  }
};

const publishes = ({ surface, file, name }) => {
  const published = surface.get(file);
  return published !== undefined && (published.has(name) || published.has("*"));
};

/** Declaration sites of one name in one package, grouped by `package|name`. */
const declarationSites = ({ files, workspace, readFile }) => {
  const byKey = new Map();
  for (const file of files) {
    if (TEST.test(file)) continue;
    if (DISCOVERED.test(file)) continue;
    const pkg = packageOf(file, workspace);
    for (const { name, line } of declarationsIn(readFile(join(ROOT, file)))) {
      const key = `${pkg}|${name}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ file, line, name });
    }
  }
  return byKey;
};

/**
 * Two spellings of one concept, rather than a convention, an overload set, or
 * two deliberate exports that happen to share a word.
 */
const isTwinGroup = ({ sites, graph, surface }) => {
  // A name in four or more files of one package is a convention, not a move.
  if (sites.length < 2 || sites.length > 3) return false;
  // Overloads and merged declarations share a file and a name by design.
  const distinctFiles = new Set(sites.map((site) => site.file));
  if (distinctFiles.size < 2) return false;
  // If one file already knows about the other, they are not rival generations.
  const linked = sites.some((left) =>
    sites.some(
      (right) => left !== right && (graph.imports.get(left.file)?.has(right.file) ?? false),
    ),
  );
  if (linked) return false;
  // Both published on the package's surface means both are deliberate. A
  // half-finished move leaves one side off it: the new file kept the export,
  // the old file kept the declaration.
  return !sites.every((site) => publishes({ surface, file: site.file, name: site.name }));
};

export const findTwins = ({ files, workspace, graph, surface = new Map(), readFile = read }) => {
  const findings = [];

  for (const sites of declarationSites({ files, workspace, readFile }).values()) {
    if (!isTwinGroup({ sites, graph, surface })) continue;

    for (const site of sites) {
      const others = sites.filter((other) => other !== site);
      findings.push({
        detector: "twin",
        file: site.file,
        line: site.line,
        detail: `\`${site.name}\` also declared in ${others.map((other) => `${other.file}:${other.line}`).join(", ")}`,
      });
    }
  }

  return findings;
};

const nonBlankLines = (file) =>
  read(file)
    .split("\n")
    .filter((line) => line.trim() !== "").length;

export const findSlackRatchets = ({ slackFactor = 1.5 } = {}) => {
  const findings = [];
  const budgetFile = "packages/architecture-enforcer/src/composition-root-line-budget.json";
  const full = join(ROOT, budgetFile);
  if (!existsSync(full)) return findings;
  let budgets;
  try {
    budgets = JSON.parse(read(full)).budgets ?? {};
  } catch {
    return findings;
  }
  for (const [path, budget] of Object.entries(budgets)) {
    const target = join(ROOT, path);
    if (!existsSync(target)) {
      findings.push({
        detector: "slack-ratchet",
        file: budgetFile,
        line: 1,
        detail: `budget names ${path}, which no longer exists`,
      });
      continue;
    }
    const measured = nonBlankLines(target);
    if (measured * slackFactor < budget) {
      findings.push({
        detector: "slack-ratchet",
        file: budgetFile,
        line: 1,
        detail: `${path} measures ${measured} lines against a stored budget of ${budget} (${(budget / measured).toFixed(1)}x slack: it may regrow ${budget - measured} lines silently)`,
      });
    }
  }
  return findings;
};

export const findDanglingGuards = ({ files, readFile = read }) => {
  const findings = [];
  const policies = files.filter(
    (file) => file.startsWith("packages/architecture-enforcer/src/") && !TEST.test(file),
  );
  for (const file of policies) {
    const text = readFile(join(ROOT, file));
    for (const match of stripComments(text).matchAll(/["']([\w.-]+-baseline\.json)["']/g)) {
      const name = match[1];
      const expected = join(ROOT, "packages/architecture-enforcer/src", name);
      if (existsSync(expected)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({
        detector: "dangling-guard",
        file,
        line,
        detail: `reads ${name}, which does not exist: the policy enforces nothing`,
      });
    }
  }
  return findings;
};

// --- self-test ---------------------------------------------------------------
// A detector nobody has watched fail is not a detector. Each case below is a
// shape this script has been wrong about, or would be wrong about if it drifted.

const selfTest = () => {
  const failures = [];
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok)
      failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  };

  check(
    "specifiers: static, from, dynamic, bare",
    specifiersIn(
      `import a from "./a.ts";\nexport { b } from "./b.ts";\nvoid import("./c.ts");\nimport "./d.ts";`,
    ),
    ["./a.ts", "./d.ts", "./b.ts", "./c.ts"],
  );
  check(
    "specifiers: a path inside a comment is not an edge",
    specifiersIn(`// import x from "./ghost.ts"\nimport y from "./real.ts";`),
    ["./real.ts"],
  );
  check(
    "specifiers: a path inside a block comment is not an edge",
    specifiersIn(`/**\n * import x from "./ghost.ts"\n */\nimport y from "./real.ts";`),
    ["./real.ts"],
  );
  // The bug that reported a declaration five lines above where it lives.
  check(
    "lines: a declaration under a doc comment keeps its real line number",
    declarationsIn(`/**\n * four\n * line\n * comment\n */\nexport type A = 1;`),
    [{ name: "A", line: 6 }],
  );
  check(
    "lines: a declaration after a line comment keeps its real line number",
    declarationsIn(`// one\n// two\nexport const b = 1;`),
    [{ name: "b", line: 3 }],
  );

  check(
    "declarations: the exported kinds",
    declarationsIn(
      `export type A = 1;\nexport class B {}\nexport abstract class C {}\nexport interface D {}\nexport function e() {}\nexport const f = 1;`,
    ).map((d) => d.name),
    ["A", "B", "C", "D", "e", "f"],
  );
  check(
    "declarations: a re-export declares nothing",
    declarationsIn(`export { A } from "./a.ts";`).map((d) => d.name),
    [],
  );

  check(
    "re-export: a relative forward is a site",
    reExportSites(`export { A } from "./a.ts";`),
    [1],
  );
  check(
    "re-export: a multi-line forward is a site",
    reExportSites(`export {\n  A,\n} from "./a.ts";`),
    [1],
  );
  check("re-export: `export *` is a site", reExportSites(`export * from "./a.ts";`), [1]);
  // The regression that produced nine phantom findings on the first real run.
  check(
    "re-export: a multi-line import is NOT a site",
    reExportSites(`import {\n  a,\n} from "./a.ts";`),
    [],
  );
  check(
    "re-export: an import after a declaration is NOT a site",
    reExportSites(`export type A = 1;\nimport {\n  b,\n} from "./b.ts";`),
    [],
  );
  check(
    "re-export: a bare-package forward is not a site",
    reExportSites(`export { A } from "@x/app";`),
    [],
  );
  check(
    "re-export: a plain import is not a site",
    reExportSites(`import { A } from "./a.ts";`),
    [],
  );
  check(
    "re-export: a package entry is exempt",
    findReExportShims({
      files: ["x/src/index.ts", "x/src/shim.ts"],
      workspace: { roots: new Set(["x/src/index.ts"]) },
      readFile: (absolute) =>
        ({
          "x/src/index.ts": `export { A } from "./a.ts";`,
          "x/src/shim.ts": `export { A } from "./a.ts";`,
        })[relative(ROOT, absolute).split("\\").join("/")] ?? "",
    }).map((f) => f.file),
    ["x/src/shim.ts"],
  );

  // The graph cases, on a synthetic workspace: this is the shape the whole
  // script exists for, and it is the one that was wrong first.
  const workspace = {
    byName: new Map([["@x/app", { dir: "x", entries: new Map([[".", "x/src/index.ts"]]) }]]),
    roots: new Set(["x/src/index.ts", "x/src/boot.entrypoint.ts"]),
  };
  const sources = {
    "x/src/index.ts": `export { live } from "./live.ts";`,
    "x/src/boot.entrypoint.ts": `import "./live.ts";`,
    "x/src/live.ts": `export const live = 1;`,
    "x/src/dead.ts": `export const dead = 1;`,
    "x/src/abandoned.ts": `export const abandoned = 1;`,
    "x/src/__tests__/abandoned.unit.test.ts": `import { abandoned } from "../abandoned.ts";`,
    "x/src/deep.ts": `export const deep = 1;`,
    "x/src/dead-chain.ts": `import "./deep.ts";`,
  };
  const files = Object.keys(sources);
  const readFile = (absolute) => sources[relative(ROOT, absolute).split("\\").join("/")] ?? "";
  const graph = buildGraph({ files, workspace, readFile });
  const graphFindings = findGraphResidue({ files, workspace, graph });
  const byDetector = (name) =>
    graphFindings
      .filter((f) => f.detector === name)
      .map((f) => f.file)
      .toSorted(byCodeUnit);

  check("graph: a file reached only by its own test is test-only", byDetector("test-only"), [
    "x/src/abandoned.ts",
  ]);
  check("graph: unreachable files are orphans", byDetector("orphan"), [
    "x/src/dead-chain.ts",
    "x/src/dead.ts",
    "x/src/deep.ts",
  ]);
  check(
    "graph: a file behind a root barrel is live",
    graphFindings.some((f) => f.file === "x/src/live.ts"),
    false,
  );

  const twins = findTwins({
    files: ["x/src/one.ts", "x/src/two.ts", "x/src/three.ts", "x/src/four.ts"],
    workspace,
    graph: {
      imports: new Map([
        ["x/src/three.ts", new Set(["x/src/four.ts"])],
        ["x/src/four.ts", new Set()],
        ["x/src/one.ts", new Set()],
        ["x/src/two.ts", new Set()],
      ]),
      importedBy: new Map(),
    },
    readFile: (absolute) =>
      ({
        "x/src/one.ts": "export type Shared = 1;",
        "x/src/two.ts": "export type Shared = 2;",
        "x/src/three.ts": "export type Linked = 1;",
        "x/src/four.ts": "export type Linked = 2;",
      })[relative(ROOT, absolute).split("\\").join("/")] ?? "",
  });
  check(
    "twin: one name in two unlinked files is a twin",
    twins.map((f) => f.file).toSorted(byCodeUnit),
    ["x/src/one.ts", "x/src/two.ts"],
  );
  check(
    "twin: a name re-declared in a file the other imports is not a twin",
    twins.some((f) => f.file.includes("three") || f.file.includes("four")),
    false,
  );
  const convention = findTwins({
    files: ["x/src/a.ts", "x/src/b.ts", "x/src/c.ts", "x/src/d.ts"],
    workspace,
    graph: { imports: new Map(), importedBy: new Map() },
    readFile: () => "export const Default = 1;",
  });
  check("twin: a name in four files of one package is a convention, not a twin", convention, []);
  const sameFile = findTwins({
    files: ["x/src/only.ts"],
    workspace,
    graph: { imports: new Map(), importedBy: new Map() },
    readFile: () => "export function f(): void {}\nexport function f(): void {}",
  });
  check("twin: two declarations in one file are overloads, not residue", sameFile, []);
  const stories = findTwins({
    files: ["x/src/a.stories.tsx", "x/src/b.stories.tsx"],
    workspace,
    graph: { imports: new Map(), importedBy: new Map() },
    readFile: () => "export const Default = 1;",
  });
  check("twin: story files are excluded", stories, []);
  const published = findTwins({
    files: ["x/src/one.ts", "x/src/two.ts"],
    workspace,
    graph: { imports: new Map(), importedBy: new Map() },
    surface: new Map([
      ["x/src/one.ts", new Set(["Shared"])],
      ["x/src/two.ts", new Set(["Shared"])],
    ]),
    readFile: () => "export type Shared = 1;",
  });
  check("twin: two spellings both on the public surface are deliberate", published, []);
  const halfPublished = findTwins({
    files: ["x/src/one.ts", "x/src/two.ts"],
    workspace,
    graph: { imports: new Map(), importedBy: new Map() },
    surface: new Map([["x/src/one.ts", new Set(["Shared"])]]),
    readFile: () => "export type Shared = 1;",
  });
  check(
    "twin: a name published from one file and only declared in the other is residue",
    halfPublished.map((f) => f.file).toSorted(byCodeUnit),
    ["x/src/one.ts", "x/src/two.ts"],
  );
  check(
    "surface: a barrel publishes the names it forwards",
    [
      ...(readPublicSurface({
        roots: new Set(["x/src/index.ts"]),
        known: new Set(["x/src/index.ts", "x/src/a.ts"]),
        readFile: () => `export { A, type B as C } from "./a.ts";`,
      }).get("x/src/a.ts") ?? []),
    ].toSorted(byCodeUnit),
    ["A", "B"],
  );

  check(
    "roots: a dist entry resolves to its source twin",
    [
      ...resolveRoots({
        rootSpecs: new Set(["s/dist/index.d.ts", "s/dist/deep/index.d.ts"]),
        known: new Set(["s/src/index.ts", "s/src/deep/index.ts"]),
      }),
    ].toSorted(byCodeUnit),
    ["s/src/deep/index.ts", "s/src/index.ts"],
  );
  check(
    "roots: a source entry resolves to itself",
    [
      ...resolveRoots({
        rootSpecs: new Set(["./p/src/main.ts"]),
        known: new Set(["p/src/main.ts"]),
      }),
    ],
    ["p/src/main.ts"],
  );

  for (const failure of failures) console.error(`self-test FAILED  ${failure}`);
  if (failures.length === 0) console.error(`self-test passed (${30} cases)`);
  return failures.length === 0 ? 0 : 2;
};

// --- cli ---------------------------------------------------------------------

const parseArguments = (argv) => {
  const onlyFlag = argv.find((argument) => argument.startsWith("--only"));
  const readOnlyValue = () =>
    onlyFlag.includes("=") ? onlyFlag.split("=")[1] : (argv[argv.indexOf(onlyFlag) + 1] ?? "");
  const onlyValue = onlyFlag ? readOnlyValue() : "";
  const only = onlyFlag ? new Set(onlyValue.split(",").filter(Boolean)) : new Set(DETECTORS);
  const positional = argv.filter(
    (argument) => !argument.startsWith("--") && argument !== onlyValue,
  );

  return { asJson: argv.includes("--json"), only, target: positional[0] };
};

const runDetectors = ({ only, files, workspace, graph, known }) => {
  const findings = [];
  if (only.has("orphan")) {
    findings.push(...findGraphResidue({ files, workspace, graph }));
  } else if (only.has("test-only")) {
    findings.push(...findGraphResidue({ files, workspace, graph }));
  }
  if (only.has("re-export")) findings.push(...findReExportShims({ files, workspace }));
  if (only.has("twin")) {
    const surface = readPublicSurface({ roots: workspace.roots, known });
    findings.push(...findTwins({ files, workspace, graph, surface }));
  }
  if (only.has("slack-ratchet")) findings.push(...findSlackRatchets());
  if (only.has("dangling-guard")) findings.push(...findDanglingGuards({ files }));

  return findings.filter((finding) => only.has(finding.detector));
};

const main = () => {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());
  if (selfTest() !== 0) process.exit(2);

  const { asJson, only, target } = parseArguments(argv);
  const workspace = readWorkspace();
  const all = listSourceFiles(null);
  const scoped = listSourceFiles(target);
  const known = new Set(all);

  workspace.roots = new Set([
    ...resolveRoots({ rootSpecs: workspace.rootSpecs, known }),
    ...findReferencedRoots({ known }),
  ]);
  const graph = buildGraph({ files: all, workspace });

  const inScope = new Set(scoped);
  const findings = runDetectors({ only, files: all, workspace, graph, known })
    .filter((finding) => !target || inScope.has(finding.file))
    .toSorted(
      (left, right) =>
        left.detector.localeCompare(right.detector) ||
        left.file.localeCompare(right.file) ||
        left.line - right.line,
    );

  if (asJson) console.log(JSON.stringify(findings, null, 2));
  else {
    for (const finding of findings) {
      console.log(
        `${finding.detector.padEnd(14)} ${finding.file}:${finding.line}  ${finding.detail}`,
      );
    }
  }

  const counts = DETECTORS.map(
    (name) => `${name} ${findings.filter((f) => f.detector === name).length}`,
  ).join(", ");
  const scope = target ? ` under ${target}` : "";
  console.error(
    `scanned ${scoped.length} file${scoped.length === 1 ? "" : "s"}${scope} of ${all.length} tracked — ${counts}`,
  );
  process.exit(findings.length > 0 ? 1 : 0);
};

main();
