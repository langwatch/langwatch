import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import ts from "typescript";

/**
 * One value-import graph walker for every rule that needs to know what a file
 * actually pulls at runtime.
 *
 * Two rules needed the same three things — parse a file's module specifiers,
 * turn a specifier into a file on disk, and follow the result — and the second
 * one nearly grew its own copy. A second resolver is not a duplicate function,
 * it is a second opinion about what the graph is: `@langwatch/react-rum` and
 * `@langwatch/react-rum/constants` are the same package and different
 * reachability stories, and a rule that resolves both to the barrel reports the
 * safe import as a leak. So resolution lives here, once, and the rules bring
 * their own policy.
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
  sourceFile: ts.SourceFile;
  imports: ModuleImport[];
  rendersJsx: boolean;
};

/**
 * Keyed by content identity, not by path. `lintFrontendUiBoundaries`'s suite
 * writes fixtures under a fresh temporary directory per test, and a path-keyed
 * cache would be correct there only by accident; a rule that rewrites a file
 * and re-reads it deserves the answer for what is on disk now.
 */
const parsedSources = new Map<string, ParsedSource>();

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx") || file.endsWith(".jsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".mts") || file.endsWith(".mjs")) return ts.ScriptKind.TS;
  if (file.endsWith(".cts") || file.endsWith(".cjs")) return ts.ScriptKind.TS;
  if (file.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseSource(file: string): ParsedSource {
  const stats = statSync(file);
  const key = `${file}\0${stats.mtimeMs}\0${stats.size}`;
  const cached = parsedSources.get(key);
  if (cached) return cached;

  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );

  const imports: ModuleImport[] = [];
  let rendersJsx = false;

  const record = (options: {
    node: ts.Node;
    specifier: ts.Expression | undefined;
    typeOnly: boolean;
  }): void => {
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
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      rendersJsx = true;
    }

    if (ts.isImportDeclaration(node)) {
      record({
        node: node.moduleSpecifier,
        specifier: node.moduleSpecifier,
        typeOnly: node.importClause?.isTypeOnly === true,
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      record({
        node: node.moduleSpecifier,
        specifier: node.moduleSpecifier,
        typeOnly: node.isTypeOnly,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record({
        node: node.moduleReference,
        specifier: node.moduleReference.expression,
        typeOnly: node.isTypeOnly,
      });
    } else if (ts.isCallExpression(node)) {
      // A dynamic `import(...)` in value position parses as a call; the two
      // type forms — `typeof import("x")` and `import("x").Foo` — parse as an
      // `ImportTypeNode` and never reach here. Deferring a heavy dependency
      // behind `await import()` is precisely how it is kept out of a boot
      // graph, so a walk blind to this edge would bless the one move most
      // likely to smuggle the UI stack back in at runtime.
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (dynamicImport || requireCall) {
        record({ node, specifier: node.arguments[0], typeOnly: false });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const parsed: ParsedSource = { sourceFile, imports, rendersJsx };
  parsedSources.set(key, parsed);
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

function readManifestRecord(options: {
  manifestPath: string;
}): PackageManifestRecord | undefined {
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
    if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
    collectManifests({
      directory: join(options.directory, entry.name),
      depth: options.depth - 1,
      found: options.found,
    });
  }
}

/**
 * A resolver over the workspace's source-linked packages.
 *
 * Workspace packages are the reason this is not `require.resolve`: their code
 * is ours, on disk, and the walk has to continue through it. Honouring
 * `exports` and `imports` is the point rather than pedantry — a package's
 * barrel and its leaf modules are different reachability stories, and the 110
 * `#`-prefixed subpath imports in the feature packages are real edges that a
 * resolver ignorant of `imports` would silently drop.
 */
export function createWorkspaceModuleResolver({
  root,
}: {
  root: string;
}): WorkspaceModuleResolver {
  const found: PackageManifestRecord[] = [];
  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const directory = join(root, workspaceRoot);
    if (!existsSync(directory)) continue;
    collectManifests({ directory, depth: WORKSPACE_MANIFEST_DEPTH, found });
  }

  const packages = new Map<string, PackageManifestRecord>();
  for (const record of found) {
    if (!packages.has(record.name)) packages.set(record.name, record);
  }
  const byDirectory = [...found].sort(
    (left, right) => right.directory.length - left.directory.length,
  );

  const owningPackage = ({ file }: { file: string }): PackageManifestRecord | undefined =>
    byDirectory.find(
      (record) => file === record.directory || file.startsWith(`${record.directory}${sep}`),
    );

  const resolveWorkspacePackage = (specifier: string): string | undefined => {
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
  };

  const resolveSubpathImport = (options: {
    specifier: string;
    file: string;
  }): string | undefined => {
    const owner = owningPackage({ file: options.file });
    const map = owner?.imports;
    if (!map) return void 0;
    const exact = map[options.specifier];
    const exactTarget = conditionTarget(exact);
    if (exactTarget) {
      return resolveSourceCandidate({ candidate: resolve(owner.directory, exactTarget) });
    }
    for (const [pattern, value] of Object.entries(map)) {
      const star = pattern.indexOf("*");
      if (star === -1) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (!options.specifier.startsWith(prefix) || !options.specifier.endsWith(suffix)) continue;
      const filled = options.specifier.slice(prefix.length, options.specifier.length - suffix.length);
      const target = conditionTarget(value);
      if (!target) continue;
      return resolveSourceCandidate({
        candidate: resolve(owner.directory, target.replace("*", filled)),
      });
    }
    return void 0;
  };

  /**
   * Resolutions are cached, and that is load-bearing rather than a nicety. A
   * miss costs a fistful of `statSync` calls — every candidate extension, twice
   * — and a popular specifier is re-asked by hundreds of importers. Only a
   * relative specifier depends on where it was written, so alias and workspace
   * specifiers share one entry rather than one per importing directory.
   */
  const resolutions = new Map<string, string | undefined>();

  const resolveSpecifier = ({
    specifier,
    file,
  }: {
    specifier: string;
    file: string;
  }): string | undefined => {
    // "\0" occurs in neither a path nor a specifier, so it separates the two
    // halves of the key unambiguously.
    const key = specifier.startsWith(".")
      ? `${dirname(file)}\0${specifier}`
      : specifier.startsWith("#")
        ? `${owningPackage({ file })?.directory ?? ""}\0${specifier}`
        : specifier;
    if (resolutions.has(key)) return resolutions.get(key);

    const resolved = specifier.startsWith(".")
      ? resolveRelativeModule({ file, specifier })
      : specifier.startsWith("#")
        ? resolveSubpathImport({ specifier, file })
        : resolveWorkspacePackage(specifier);
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
 * Walk the value-import graph forward from `roots`, recording edges and the
 * files that reach something forbidden directly.
 *
 * `terminal` stops the walk on entry rather than excusing an importer: a
 * service that sends mail is not reported for the React its templates
 * legitimately render with, but a file that reaches the terminal's neighbours
 * some other way still is.
 */
export function walkValueImportGraph({
  roots,
  resolve: resolveSpecifier,
  forbidden,
  terminal,
  emitted,
}: {
  roots: readonly string[];
  resolve: (options: { specifier: string; file: string }) => string | undefined;
  forbidden: (options: { specifier: string; file: string; target?: string }) => string | undefined;
  terminal?: (options: { file: string }) => boolean;
  emitted?: (options: { file: string }) => string | undefined;
}): ValueImportGraph {
  const children = new Map<string, readonly string[]>();
  const seeds = new Map<string, string>();
  const seen = new Set<string>(roots);
  const queue = [...roots];

  while (queue.length > 0) {
    const file = queue.pop()!;
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
 * The chain from each root to whatever seeded the graph, as a fixed point
 * rather than by recursive descent.
 *
 * Recursion has to cut import cycles, and this codebase has them. A "cannot
 * reach" answer computed under a cut cycle is not sound, so it cannot be
 * cached — which means it is recomputed from every path that reaches it, and
 * the walk degrades sharply as the graph grows. Flooding backwards from the
 * seeds makes a cycle a non-event — it yields a chain only if something inside
 * it does — and settles every node exactly once, in O(files + imports).
 */
export function chainsToSeeds({
  roots,
  graph,
}: {
  roots: readonly string[];
  graph: ValueImportGraph;
}): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const [file, edges] of graph.children) {
    for (const edge of edges) {
      const known = parents.get(edge);
      if (known) known.push(file);
      else parents.set(edge, [file]);
    }
  }

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

  const chains = new Map<string, string[]>();
  for (const root of roots) {
    if (!via.has(root)) continue;
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
    chains.set(root, chain);
  }
  return chains;
}
