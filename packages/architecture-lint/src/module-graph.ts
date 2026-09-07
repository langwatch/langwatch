import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import ts from "typescript";

/**
 * Rules share source resolution so package barrels and safe leaf exports retain
 * their distinct runtime reachability. Resolving both to the barrel would
 * incorrectly report a leaf import as a dependency leak.
 */

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Where a workspace package may be declared. Mirrors `pnpm-workspace.yaml`. */
const WORKSPACE_ROOTS = ["apps", "packages", "sdks", "mcp", "plugins", "services", "skills"];

/**
 * How deep below a workspace root a `package.json` may sit.
 *
 * Four is what the deepest glob in `pnpm-workspace.yaml` needs
 * (`packages/enterprise/features/<feature>/<role>`), and a bound is what keeps
 * this from descending through `apps/ui/src` — thousands of directories that
 * cannot contain a workspace manifest — on every lint run.
 */
const WORKSPACE_MANIFEST_DEPTH = 4;

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "coverage", ".git"]);

/**
 * Conditions read in the order a Node runtime would pick them, so a package
 * that ships different code to the server and the browser is followed the way
 * the server loads it. `types` is last, and only reached when a manifest offers
 * nothing else — a `.d.ts` is a dead end for a value walk.
 */
const EXPORT_CONDITIONS = ["node", "import", "require", "default", "types"];

export type ModuleImport = {
  file: string;
  line: number;
  specifier: string;
  nonLiteral: boolean;
  /**
   * `import type` / `export type`, which the compiler erases. A value walk must
   * skip these or every type annotation naming a component reads as a leak.
   * Inline `{ type A, b }` is NOT type-only: `b` is a value, and under
   * `verbatimModuleSyntax` even `{ type A }` alone still emits the import.
   */
  typeOnly: boolean;
};

export type PackageManifestRecord = {
  name: string;
  directory: string;
  manifestPath: string;
  main?: string;
  exports?: unknown;
  imports?: Record<string, unknown>;
};

export type WorkspaceModuleResolver = {
  /** Every workspace package this resolver found, by declared package name. */
  readonly packages: ReadonlyMap<string, PackageManifestRecord>;
  /** The workspace package that owns `file`, by longest directory prefix. */
  owningPackage: (options: { file: string }) => PackageManifestRecord | undefined;
  /** The file a specifier loads, or `undefined` for a specifier off the source tree. */
  resolve: (options: { specifier: string; file: string }) => string | undefined;
};

type ParsedSource = {
  imports: ModuleImport[];
  rendersJsx: boolean;
};

type ParsedSourceCacheEntry = ParsedSource & {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
};

/**
 * Keyed by path with filesystem freshness metadata. The AST is deliberately
 * not retained: the derived import facts are all callers need, and retaining
 * every SourceFile keeps the whole workspace tree alive for the process.
 */
const parsedSources = new Map<string, ParsedSourceCacheEntry>();

function scriptKind(file: string): ts.ScriptKind {
  const isTsxLike = file.endsWith(".tsx") || file.endsWith(".jsx");
  if (isTsxLike) return ts.ScriptKind.TSX;

  const isEsmOrCjsTypeScript = file.endsWith(".mts") || file.endsWith(".mjs");
  if (isEsmOrCjsTypeScript) return ts.ScriptKind.TS;

  const isCommonJsTypeScript = file.endsWith(".cts") || file.endsWith(".cjs");
  if (isCommonJsTypeScript) return ts.ScriptKind.TS;

  if (file.endsWith(".js")) return ts.ScriptKind.JS;

  return ts.ScriptKind.TS;
}

function isJsxNode(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

type ImportRecordInput = { node: ts.Node; specifier: ts.Expression | undefined; typeOnly: boolean };

/**
 * A dynamic `import(...)` in value position parses as a call; the two type
 * forms — `typeof import("x")` and `import("x").Foo` — parse as an
 * `ImportTypeNode` and never reach here. Deferring a heavy dependency behind
 * `await import()` is precisely how it is kept out of a boot graph, so a walk
 * blind to this edge would bless the one move most likely to smuggle the UI
 * stack back in at runtime.
 */
function dynamicImportRecord(node: ts.CallExpression): ImportRecordInput | undefined {
  const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const requireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
  if (!dynamicImport && !requireCall) return undefined;

  return { node, specifier: node.arguments[0], typeOnly: false };
}

/** The import-record input for one AST node, across every module-specifier-bearing form. */
function importRecordFor(node: ts.Node): ImportRecordInput | undefined {
  if (ts.isImportDeclaration(node)) {
    return {
      node: node.moduleSpecifier,
      specifier: node.moduleSpecifier,
      typeOnly: node.importClause?.isTypeOnly === true,
    };
  }

  const isNamedExport = ts.isExportDeclaration(node) && node.moduleSpecifier;
  if (isNamedExport) {
    return {
      node: node.moduleSpecifier,
      specifier: node.moduleSpecifier,
      typeOnly: node.isTypeOnly,
    };
  }

  const isImportEquals =
    ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference);
  if (isImportEquals) {
    return {
      node: node.moduleReference,
      specifier: node.moduleReference.expression,
      typeOnly: node.isTypeOnly,
    };
  }

  return ts.isCallExpression(node) ? dynamicImportRecord(node) : undefined;
}

function parseSource(file: string): ParsedSource {
  const stats = statSync(file);
  const cached = parsedSources.get(file);
  const sameVersion =
    cached?.mtimeMs === stats.mtimeMs &&
    cached?.ctimeMs === stats.ctimeMs &&
    cached?.size === stats.size;
  if (cached && sameVersion) {
    return cached;
  }

  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );

  const imports: ModuleImport[] = [];
  let rendersJsx = false;

  const record = (options: ImportRecordInput): void => {
    const literal =
      options.specifier !== void 0 && ts.isStringLiteralLike(options.specifier)
        ? options.specifier
        : void 0;
    imports.push({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(options.node.getStart(sourceFile)).line + 1,
      specifier: literal ? literal.text : "<non-literal module specifier>",
      nonLiteral: literal === void 0,
      typeOnly: options.typeOnly,
    });
  };

  const visit = (node: ts.Node): void => {
    if (isJsxNode(node)) rendersJsx = true;

    const importRecord = importRecordFor(node);
    if (importRecord) record(importRecord);

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const parsed = { imports, rendersJsx };
  parsedSources.set(file, {
    ...parsed,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    size: stats.size,
  });

  return parsed;
}

/** Every module specifier this file names, type-only ones included and flagged. */
export function moduleImports({ file }: { file: string }): readonly ModuleImport[] {
  return parseSource(file).imports;
}

/** The specifiers this file pulls at runtime. */
export function valueImports({ file }: { file: string }): readonly ModuleImport[] {
  return parseSource(file).imports.filter((entry) => !entry.typeOnly && !entry.nonLiteral);
}

/**
 * Whether the compiler emits a `react/jsx-runtime` import for this file.
 *
 * Under `jsx: "react-jsx"` that import appears nowhere in the source, so no
 * amount of reading specifiers will find it. An icon component with no import
 * statement at all still loads React, and without this it looks inert — a dead
 * end in the walk rather than the React leaf it is.
 */
export function rendersJsx({ file }: { file: string }): boolean {
  return parseSource(file).rendersJsx;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** The file a path stem names: itself, plus an extension, or a directory index. */
export function resolveSourceCandidate({ candidate }: { candidate: string }): string | undefined {
  // An ESM-style ".js" specifier points at a TypeScript source on disk.
  const stems = candidate.endsWith(".js") ? [candidate, candidate.slice(0, -3)] : [candidate];
  for (const stem of stems) {
    const paths = [
      stem,
      ...SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`),
      ...SOURCE_EXTENSIONS.map((extension) => join(stem, `index${extension}`)),
    ];
    const found = paths.find((path) => isFile(path));
    if (found) return found;
  }

  return void 0;
}

/** The file a relative specifier names, or `undefined` if it is not relative. */
export function resolveRelativeModule({
  file,
  specifier,
}: {
  file: string;
  specifier: string;
}): string | undefined {
  if (!specifier.startsWith(".")) return void 0;

  return resolveSourceCandidate({ candidate: resolve(dirname(file), specifier) });
}

function conditionTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;

  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;

  const record = value as Record<string, unknown>;
  for (const condition of EXPORT_CONDITIONS) {
    if (!(condition in record)) continue;

    const target = conditionTarget(record[condition]);
    if (target) return target;
  }

  return void 0;
}

function subpathTarget(options: {
  manifest: PackageManifestRecord;
  subpath: string;
}): string | undefined {
  const { manifest, subpath } = options;
  const map = manifest.exports;
  if (map === void 0 || map === null) {
    return subpath === "." ? manifest.main : void 0;
  }

  // `"exports": "./src/index.ts"` and `"exports": { "node": ... }` both describe
  // the root only; a subpath asked of either is genuinely not published.
  if (typeof map === "string" || Array.isArray(map)) {
    return subpath === "." ? conditionTarget(map) : void 0;
  }

  const record = map as Record<string, unknown>;
  const hasSubpaths = Object.keys(record).some((key) => key.startsWith("."));
  if (!hasSubpaths) return subpath === "." ? conditionTarget(record) : void 0;

  if (subpath in record) return conditionTarget(record[subpath]);

  return subpath === "." ? manifest.main : void 0;
}

function readManifestRecord(options: { manifestPath: string }): PackageManifestRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  } catch {
    return void 0;
  }

  if (!parsed || typeof parsed !== "object") return void 0;

  const manifest = parsed as {
    name?: unknown;
    main?: unknown;
    exports?: unknown;
    imports?: unknown;
  };
  if (typeof manifest.name !== "string") return void 0;

  return {
    name: manifest.name,
    directory: dirname(options.manifestPath),
    manifestPath: options.manifestPath,
    main: typeof manifest.main === "string" ? manifest.main : void 0,
    exports: manifest.exports,
    imports:
      manifest.imports && typeof manifest.imports === "object" && !Array.isArray(manifest.imports)
        ? (manifest.imports as Record<string, unknown>)
        : void 0,
  };
}

function collectManifests(options: {
  directory: string;
  depth: number;
  found: PackageManifestRecord[];
}): void {
  const manifestPath = join(options.directory, "package.json");
  if (isFile(manifestPath)) {
    const record = readManifestRecord({ manifestPath });
    if (record) options.found.push(record);
  }

  if (options.depth === 0) return;

  let entries;
  try {
    entries = readdirSync(options.directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const isIgnoredDirectory = entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name);
    if (isIgnoredDirectory) continue;

    collectManifests({
      directory: join(options.directory, entry.name),
      depth: options.depth - 1,
      found: options.found,
    });
  }
}

function collectWorkspaceManifests(root: string): PackageManifestRecord[] {
  const found: PackageManifestRecord[] = [];
  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const directory = join(root, workspaceRoot);
    if (!existsSync(directory)) continue;

    collectManifests({ directory, depth: WORKSPACE_MANIFEST_DEPTH, found });
  }

  return found;
}

type OwningPackageLookup = (options: { file: string }) => PackageManifestRecord | undefined;

function resolveWorkspacePackage(
  specifier: string,
  packages: ReadonlyMap<string, PackageManifestRecord>,
): string | undefined {
  const segments = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const name = scoped ? segments.slice(0, 2).join("/") : segments[0];
  if (!name) return void 0;

  const manifest = packages.get(name);
  if (!manifest) return void 0;

  const rest = segments.slice(scoped ? 2 : 1);
  const subpath = rest.length > 0 ? `./${rest.join("/")}` : ".";
  const target = subpathTarget({ manifest, subpath });
  if (!target) return void 0;

  return resolveSourceCandidate({ candidate: resolve(manifest.directory, target) });
}

/** The `imports` entry a subpath import (`#foo`) resolves to, following one wildcard pattern. */
function resolveWildcardSubpathImport(
  specifier: string,
  owner: PackageManifestRecord,
  map: Record<string, unknown>,
): string | undefined {
  for (const [pattern, value] of Object.entries(map)) {
    const star = pattern.indexOf("*");
    if (star === -1) continue;

    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    const matchesWildcardPattern = specifier.startsWith(prefix) && specifier.endsWith(suffix);
    if (!matchesWildcardPattern) continue;

    const filled = specifier.slice(prefix.length, specifier.length - suffix.length);
    const target = conditionTarget(value);
    if (!target) continue;

    return resolveSourceCandidate({
      candidate: resolve(owner.directory, target.replace("*", filled)),
    });
  }

  return void 0;
}

function resolveSubpathImport(
  options: { specifier: string; file: string },
  owningPackage: OwningPackageLookup,
): string | undefined {
  const owner = owningPackage({ file: options.file });
  const map = owner?.imports;
  if (!map || !owner) return void 0;

  const exactTarget = conditionTarget(map[options.specifier]);
  if (exactTarget) {
    return resolveSourceCandidate({ candidate: resolve(owner.directory, exactTarget) });
  }

  return resolveWildcardSubpathImport(options.specifier, owner, map);
}

/** "\0" occurs in neither a path nor a specifier, so it separates the two halves of a cache key. */
function resolutionCacheKey(
  specifier: string,
  file: string,
  owningPackage: OwningPackageLookup,
): string {
  if (specifier.startsWith(".")) return `${dirname(file)}\0${specifier}`;

  if (specifier.startsWith("#")) return `${owningPackage({ file })?.directory ?? ""}\0${specifier}`;

  return specifier;
}

function resolveSpecifierUncached(
  specifier: string,
  file: string,
  packages: ReadonlyMap<string, PackageManifestRecord>,
  owningPackage: OwningPackageLookup,
): string | undefined {
  if (specifier.startsWith(".")) return resolveRelativeModule({ file, specifier });

  if (specifier.startsWith("#")) return resolveSubpathImport({ specifier, file }, owningPackage);

  return resolveWorkspacePackage(specifier, packages);
}

/**
 * Follow workspace source through both `exports` and private `imports`.
 * Each leaf must resolve independently of its package barrel; `#` subpaths
 * participate in the same reachability graph as public exports.
 */
export function createWorkspaceModuleResolver({ root }: { root: string }): WorkspaceModuleResolver {
  const found = collectWorkspaceManifests(root);

  const packages = new Map<string, PackageManifestRecord>();
  for (const record of found) {
    if (!packages.has(record.name)) packages.set(record.name, record);
  }

  const byDirectory = [...found].sort(
    (left, right) => right.directory.length - left.directory.length,
  );

  const owningPackage: OwningPackageLookup = ({ file }) =>
    byDirectory.find(
      (record) => file === record.directory || file.startsWith(`${record.directory}${sep}`),
    );

  // Resolutions are cached, and that is load-bearing rather than a nicety. A
  // miss costs a fistful of `statSync` calls — every candidate extension,
  // twice — and a popular specifier is re-asked by hundreds of importers.
  const resolutions = new Map<string, string | undefined>();

  const resolveSpecifier = ({
    specifier,
    file,
  }: {
    specifier: string;
    file: string;
  }): string | undefined => {
    const key = resolutionCacheKey(specifier, file, owningPackage);
    if (resolutions.has(key)) return resolutions.get(key);

    const resolved = resolveSpecifierUncached(specifier, file, packages, owningPackage);
    resolutions.set(key, resolved);

    return resolved;
  };

  return { packages, owningPackage, resolve: resolveSpecifier };
}

export type ValueImportGraph = {
  /** Every walked file, mapped to the source files it pulls at runtime. */
  children: ReadonlyMap<string, readonly string[]>;
  /** Files that reach a forbidden edge themselves, mapped to what they reach. */
  seeds: ReadonlyMap<string, string>;
};

/**
 * `terminal` stops traversal on entry: callers may reach React through mail
 * templates, but reaching React through another path must still be reported.
 */
type ValueImportGraphOptions = {
  resolve: (options: { specifier: string; file: string }) => string | undefined;
  forbidden: (options: { specifier: string; file: string; target?: string }) => string | undefined;
  terminal?: (options: { file: string }) => boolean;
  emitted?: (options: { file: string }) => string | undefined;
};

/**
 * One file's outgoing edges, recording a forbidden or emitted reason into
 * `seeds` (mutated in place) rather than returning it — a file can seed the
 * graph without having any edges of its own.
 */
function edgesForFile(
  file: string,
  options: ValueImportGraphOptions,
  seeds: Map<string, string>,
): string[] {
  const { resolve: resolveSpecifier, forbidden, terminal, emitted } = options;
  const edges: string[] = [];
  for (const entry of valueImports({ file })) {
    const target = resolveSpecifier({ specifier: entry.specifier, file });
    const reason = forbidden({ specifier: entry.specifier, file, target });
    if (reason !== void 0) {
      if (!seeds.has(file)) seeds.set(file, reason);

      continue;
    }

    if (target === void 0) continue;

    if (terminal?.({ file: target }) === true) continue;

    edges.push(target);
  }

  // After the specifiers, so an explicit forbidden import stays the reported
  // cause and a compiler-emitted edge is only the fallback.
  if (!seeds.has(file)) {
    const emittedReason = emitted?.({ file });
    if (emittedReason !== void 0) seeds.set(file, emittedReason);
  }

  return edges;
}

export function walkValueImportGraph({
  roots,
  ...options
}: { roots: readonly string[] } & ValueImportGraphOptions): ValueImportGraph {
  const children = new Map<string, readonly string[]>();
  const seeds = new Map<string, string>();
  const seen = new Set<string>(roots);
  const queue = [...roots];

  while (queue.length > 0) {
    const file = queue.pop()!;
    const edges = edgesForFile(file, options, seeds);

    children.set(file, edges);
    for (const edge of edges) {
      if (seen.has(edge)) continue;

      seen.add(edge);
      queue.push(edge);
    }
  }

  return { children, seeds };
}

/**
 * Flooding backwards from forbidden seeds handles import cycles without caching
 * unsound "cannot reach" answers from cut cycles. Each node settles once,
 * keeping traversal O(files + imports).
 */
/** Every edge's target mapped back to the files that reach it, the reverse of `graph.children`. */
function parentsIndex(graph: ValueImportGraph): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const [file, edges] of graph.children) {
    for (const edge of edges) {
      const known = parents.get(edge);
      if (known) known.push(file);
      else parents.set(edge, [file]);
    }
  }

  return parents;
}

/** Each node's next hop toward a seed, flooded backwards from the seeds so a cycle settles once. */
function floodViaFromSeeds(
  graph: ValueImportGraph,
  parents: Map<string, string[]>,
): Map<string, string | undefined> {
  const via = new Map<string, string | undefined>();
  const work: string[] = [];
  for (const file of graph.seeds.keys()) {
    via.set(file, void 0);
    work.push(file);
  }

  while (work.length > 0) {
    const node = work.pop()!;
    for (const parent of parents.get(node) ?? []) {
      if (via.has(parent)) continue;

      via.set(parent, node);
      work.push(parent);
    }
  }

  return via;
}

/** The chain from `root` to whatever seeded the graph, or `undefined` when it never reaches one. */
function chainFromRoot(
  root: string,
  via: Map<string, string | undefined>,
  graph: ValueImportGraph,
): string[] | undefined {
  if (!via.has(root)) return undefined;

  const chain: string[] = [];
  const guard = new Set<string>();
  let cursor: string | undefined = root;
  while (cursor !== void 0 && !guard.has(cursor)) {
    guard.add(cursor);
    chain.push(cursor);
    const next: string | undefined = via.get(cursor);
    if (next === void 0) {
      chain.push(graph.seeds.get(cursor)!);
      break;
    }

    cursor = next;
  }

  return chain;
}

export function chainsToSeeds({
  roots,
  graph,
}: {
  roots: readonly string[];
  graph: ValueImportGraph;
}): Map<string, string[]> {
  const parents = parentsIndex(graph);
  const via = floodViaFromSeeds(graph, parents);

  const chains = new Map<string, string[]>();
  for (const root of roots) {
    const chain = chainFromRoot(root, via, graph);
    if (chain) chains.set(root, chain);
  }

  return chains;
}
