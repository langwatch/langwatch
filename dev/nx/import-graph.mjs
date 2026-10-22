// The repository's import graph, for choosing the tests an edit reaches
// (`pnpm test:changed`). Imports resolve the way Vitest resolves them here and
// type-only ones are dropped; each file's scan and resolution stay in a cache
// file until the file or its surroundings change. ADR-182.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, matchesGlob, posix } from "node:path";

const CACHE_VERSION = 2;
const SCANNED = /\.[cm]?[jt]sx?$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const VITEST_CONFIG = /^vitest(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs", ".json"];
const INDEXES = ["/index.ts", "/index.tsx", "/index.js", "/index.mts", "/index.mjs"];
const EXPORT_CONDITIONS = [
  "source",
  "development",
  "import",
  "default",
  "types",
  "node",
  "require",
];

// One alternation per way a module names another: static import/export, side
// effect import, dynamic import, vi.mock, require, new URL(…, import.meta.url)
// and import.meta.glob. Group 1 holds a static import's clause, so a type-only
// one can be told apart.
const IMPORT =
  /(?:^|[\s;}])((?:import|export)\s[^'";]*?)from\s*['"]([^'"]+)['"]|(?:^|[\s;(,=!])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bvi\.(?:mock|doMock|importActual)\(\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bnew URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url|\bimport\.meta\.glob\(\s*['"]([^'"]+)['"]/gm;
const TYPE_ONLY = /^(?:import|export)\s+type\s+(?!from\b)/;
const RELATIVE_LITERAL = /['"](\.{1,2}\/[^'"\n]+)['"]/g;

export const isTestFile = (file) => TEST.test(file);
const isVitestConfig = (file) => VITEST_CONFIG.test(basename(file));

/**
 * The module specifiers a file names, type-only imports left out. A Vitest
 * config also names its `setupFiles` and other relative paths as plain strings,
 * so every relative string literal in one counts as an import.
 */
export function scanSpecifiers({ file, text }) {
  const specifiers = new Set();
  for (const match of text.matchAll(IMPORT)) {
    const [, clause, ...rest] = match;
    if (clause !== undefined && TYPE_ONLY.test(clause.trim())) continue;
    const specifier = rest.find((value) => value !== undefined);
    const glob = match[8] !== undefined;
    specifiers.add(glob ? `glob:${specifier}` : specifier);
  }
  if (isVitestConfig(file)) {
    for (const [, literal] of text.matchAll(RELATIVE_LITERAL)) specifiers.add(literal);
  }

  return [...specifiers];
}

/** Strips JSONC comments and trailing commas, leaving strings alone. */
function parseJsonc(text) {
  const stripped = text.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (all, string) => (string === undefined ? "" : string),
  );

  return JSON.parse(stripped.replace(/,(\s*[}\]])/g, "$1"));
}

function pickTarget(value) {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
  for (const condition of EXPORT_CONDITIONS) {
    const target = pickTarget(value[condition]);
    if (target !== undefined) return target;
  }

  return void 0;
}

/** A key of an `exports`/`imports`/`paths` map that matches `request`, `*` expanded. */
function matchPattern(map, request) {
  if (Object.hasOwn(map, request)) return { value: map[request], star: void 0 };
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
    if (
      request.startsWith(prefix) &&
      request.endsWith(suffix) &&
      request.length >= key.length - 1
    ) {
      return { value, star: request.slice(prefix.length, request.length - suffix.length) };
    }
  }

  return void 0;
}

function git({ root, args }) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 1 << 28, encoding: "utf8" });
}

/** Tracked and untracked (not ignored) files, deleted ones left out by the caller's stat. */
function listFiles(root) {
  const listed = git({
    root,
    args: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  });

  return [...new Set(listed.split("\0"))].filter(
    (file) => file !== "" && !file.includes("node_modules/"),
  );
}

function statOf(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat : void 0;
  } catch {
    return void 0;
  }
}

function readCache(cacheFile) {
  try {
    const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
    return cache.version === CACHE_VERSION ? cache : void 0;
  } catch {
    return void 0;
  }
}

/** Every file, and each source file's specifiers, read again only where mtime or size moved. */
function scanAll({ root, files, cached }) {
  const scanned = new Map();
  const present = [];
  for (const file of files) {
    if (!SCANNED.test(file)) {
      present.push(file);
      continue;
    }
    const stat = statOf(join(root, file));
    if (stat === undefined) continue;
    present.push(file);
    const hit = cached[file];
    if (hit !== undefined && hit[0] === stat.mtimeMs && hit[1] === stat.size) {
      scanned.set(file, { entry: hit, fresh: false });
      continue;
    }
    const text = readFileSync(join(root, file), "utf8");
    scanned.set(file, {
      entry: [stat.mtimeMs, stat.size, scanSpecifiers({ file, text })],
      fresh: true,
    });
  }

  return { present, scanned };
}

/**
 * What every resolution depends on besides the importing file: the file list
 * and the manifests that map names to files. While it holds, a file whose
 * text is unchanged imports the same files as last time.
 */
function resolutionKey({ root, present }) {
  const hash = createHash("sha1");
  for (const file of present) {
    hash.update(file);
    hash.update("\0");
    const name = basename(file);
    if (name === "package.json" || name === "tsconfig.json") {
      hash.update(String(statOf(join(root, file))?.mtimeMs));
    }
  }

  return hash.digest("hex");
}

function readJson({ root, file, parse }) {
  try {
    return parse(readFileSync(join(root, file), "utf8"));
  } catch {
    return void 0;
  }
}

/** package.json and tsconfig.json by directory, for the lookups resolution needs. */
function manifests({ root, files }) {
  const packages = new Map();
  const packageByDir = new Map();
  const pathsByDir = new Map();
  for (const file of files) {
    const dir = posix.dirname(file);
    if (basename(file) === "package.json") {
      const manifest = readJson({ root, file, parse: JSON.parse });
      if (manifest === undefined) continue;
      const entry = {
        dir,
        exports: manifest.exports,
        imports: manifest.imports,
        main: manifest.main,
      };
      if (manifest.name !== undefined) packages.set(manifest.name, entry);
      packageByDir.set(dir, entry);
    } else if (basename(file) === "tsconfig.json") {
      const options = readJson({ root, file, parse: parseJsonc })?.compilerOptions;
      if (options?.paths === undefined) continue;
      pathsByDir.set(dir, { base: posix.join(dir, options.baseUrl ?? "."), paths: options.paths });
    }
  }

  return { packages, packageByDir, pathsByDir };
}

/** The entry for `dir` or its closest ancestor that has one. */
function nearest({ map, dir }) {
  const segments = dir === "." ? [] : dir.split("/");
  for (let depth = segments.length; depth >= 0; depth--) {
    const found = map.get(depth === 0 ? "." : segments.slice(0, depth).join("/"));
    if (found !== undefined) return found;
  }

  return void 0;
}

function resolveFile({ known }, path) {
  const plain = posix.normalize(path).replace(/^\.\//, "");
  const stem = plain.replace(/\.[cm]?jsx?$/, "");
  const candidates = [
    ...EXTENSIONS.flatMap((extension) => [plain + extension, stem + extension]),
    ...INDEXES.map((index) => plain + index),
  ];

  return candidates.find((candidate) => known.has(candidate));
}

/** A target inside a package: as written, then its src twin for a dist path. */
function resolveTarget(context, { dir, target }) {
  const path = posix.join(dir, target);
  const source = path.replace(/\/dist\//, "/src/").replace(/\.d\.[cm]?ts$/, "");

  return resolveFile(context, path) ?? resolveFile(context, source);
}

/** The target a matched map entry names, its `*` filled in. */
function expand(found) {
  const picked = pickTarget(found?.value);
  if (picked === undefined || found.star === undefined) return picked;

  return picked.replaceAll("*", found.star);
}

function hasSubpathKeys(exports) {
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) return false;

  return Object.keys(exports).some((key) => key.startsWith("."));
}

function packageTarget({ entry, sub }) {
  if (hasSubpathKeys(entry.exports)) return expand(matchPattern(entry.exports, `.${sub}`));
  if (sub !== "") return `.${sub}`;

  return pickTarget(entry.exports) ?? entry.main;
}

function resolveWorkspace(context, specifier) {
  const match = /^(@[^/]+\/[^/]+|[^@/][^/]*)(\/.*)?$/.exec(specifier);
  const entry = match === null ? void 0 : context.packages.get(match[1]);
  if (entry === undefined) return void 0;
  const sub = match[2] ?? "";
  const target = packageTarget({ entry, sub });
  const resolved =
    target === undefined ? void 0 : resolveTarget(context, { dir: entry.dir, target });
  const fallback = posix.join(entry.dir, `src${sub === "" ? "/index" : sub}`);

  return resolved ?? resolveFile(context, fallback);
}

function resolveSubpath(context, { dir, specifier }) {
  const entry = nearest({ map: context.packageByDir, dir });
  if (entry?.imports === undefined) return void 0;
  const target = expand(matchPattern(entry.imports, specifier));

  return target === undefined ? void 0 : resolveTarget(context, { dir: entry.dir, target });
}

function resolvePaths(context, { dir, specifier }) {
  const config = nearest({ map: context.pathsByDir, dir });
  const found = config === undefined ? void 0 : matchPattern(config.paths, specifier);
  if (found === undefined || !Array.isArray(found.value)) return void 0;
  const targets = found.value.map((target) =>
    found.star === undefined ? target : target.replaceAll("*", found.star),
  );

  return targets
    .map((target) => resolveFile(context, posix.join(config.base, target)))
    .find((resolved) => resolved !== undefined);
}

function resolveGlob({ files }, { dir, pattern }) {
  const absolute = pattern.startsWith("/") ? pattern.slice(1) : posix.join(dir, pattern);

  return files.filter((file) => matchesGlob(file, absolute));
}

/** The repository files a specifier written in a file under `dir` names. */
function resolveSpecifier(context, { dir, specifier }) {
  if (specifier.startsWith("glob:")) {
    return resolveGlob(context, { dir, pattern: specifier.slice(5) });
  }
  const bare = specifier.replace(/[?#].*$/, "");
  let found;
  if (specifier.startsWith(".")) found = resolveFile(context, posix.join(dir, bare));
  else if (specifier.startsWith("#")) found = resolveSubpath(context, { dir, specifier });
  else found = resolveWorkspace(context, bare) ?? resolvePaths(context, { dir, specifier: bare });

  return found === undefined ? [] : [found];
}

/** The files `file` imports: kept from the cache while valid, resolved otherwise. */
function importsOf({ file, scan, keyHeld, context }) {
  const [, , specifiers, kept] = scan.entry;
  if (keyHeld && !scan.fresh && kept !== undefined) return { targets: kept, resolved: false };
  const dir = posix.dirname(file);
  const found = new Set(
    specifiers.flatMap((specifier) => resolveSpecifier(context(), { dir, specifier })),
  );
  found.delete(file);

  return { targets: [...found], resolved: true };
}

/**
 * Builds the graph for `root`. With `cacheFile`, a file whose text and
 * surroundings are unchanged reuses its last scan and resolution. Returns the
 * files, which import which, and timings.
 */
export function buildImportGraph({ root, cacheFile }) {
  const started = performance.now();
  const listed = listFiles(root);
  const listedAt = performance.now();
  const cache = cacheFile === undefined ? void 0 : readCache(cacheFile);
  const { present, scanned } = scanAll({ root, files: listed, cached: cache?.files ?? {} });
  const key = resolutionKey({ root, present });
  const scannedAt = performance.now();
  const keyHeld = cache?.key === key;
  let resolution;
  const context = () => {
    resolution ??= {
      files: present,
      known: new Set(present),
      ...manifests({ root, files: listed }),
    };
    return resolution;
  };
  const index = new Map(present.map((file, position) => [file, position]));
  const imports = present.map(() => []);
  const nextFiles = {};
  let rescanned = 0;
  let resolved = 0;
  let edges = 0;
  for (const [file, scan] of scanned) {
    const result = importsOf({ file, scan, keyHeld, context });
    rescanned += Number(scan.fresh);
    resolved += Number(result.resolved);
    nextFiles[file] = [...scan.entry.slice(0, 3), result.targets];
    imports[index.get(file)] = result.targets.map((target) => index.get(target));
    edges += result.targets.length;
  }
  if (cacheFile !== undefined && resolved > 0) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ version: CACHE_VERSION, key, files: nextFiles }));
  }
  const importers = present.map(() => []);
  for (const [position, targets] of imports.entries()) {
    for (const target of targets) importers[target].push(position);
  }
  const done = performance.now();

  return {
    files: present,
    index,
    imports,
    importers,
    stats: {
      files: present.length,
      edges,
      rescanned,
      resolved,
      ms: {
        list: Math.round(listedAt - started),
        scan: Math.round(scannedAt - listedAt),
        resolve: Math.round(done - scannedAt),
        total: Math.round(done - started),
      },
    },
  };
}

/** Every file that imports one of `changed`, directly or not, the changed files included. */
export function reachedFrom({ graph, changed }) {
  const { importers } = graph;
  const seen = new Uint8Array(graph.files.length);
  const queue = [];
  for (const file of changed) {
    const position = graph.index.get(file);
    if (position === undefined || seen[position] === 1) continue;
    seen[position] = 1;
    queue.push(position);
  }
  for (let head = 0; head < queue.length; head++) {
    for (const importer of importers[queue[head]]) {
      if (seen[importer] === 1) continue;
      seen[importer] = 1;
      queue.push(importer);
    }
  }

  return queue.map((position) => graph.files[position]);
}
