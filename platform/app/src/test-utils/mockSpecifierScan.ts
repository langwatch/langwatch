import { statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import ts from "typescript";

/**
 * Static scan for `vi.mock` specifiers that name no module.
 *
 * `vi.mock("<specifier>")` does not fail when the specifier resolves to
 * nothing. Vitest registers a mock for a module id that is never requested,
 * the real module loads instead, and the suite goes green while asserting
 * against the thing it meant to replace. A path copied out of the module
 * under test into its `__tests__/` subdirectory is off by one directory
 * level and lands exactly there.
 *
 * Enforced from `__tests__/mockSpecifierScan.unit.test.ts`, which pins the
 * rule on snippets and then runs it over every tracked test file, so the
 * check rides the ordinary unit shards.
 *
 * Spec: specs/setup/test-mock-specifier-resolution.feature
 */

/** One `vi.mock` / `vi.doMock` / `vi.unmock` / `vi.doUnmock` call site. */
export type MockSpecifierSite = {
  /** 1-based line of the call. */
  line: number;
  /** The module named, or undefined when it is computed at runtime. */
  specifier: string | undefined;
};

/** One entry of a vitest config's module-alias table. */
export type ModuleAlias = {
  /** The specifier prefix to match. */
  find: string;
  /** The absolute path it expands to. */
  replacement: string;
};

export type MockSpecifierResolution =
  /** Names a file on disk. */
  | { kind: "resolved"; file: string }
  /** A bare package specifier, resolved by node rather than by path. */
  | { kind: "package" }
  /** Computed at runtime, so no static answer exists. */
  | { kind: "dynamic" }
  /** Names a path, and nothing is there. */
  | { kind: "missing"; candidates: string[] };

const MOCK_METHODS = new Set(["mock", "doMock", "unmock", "doUnmock"]);

/** Extensions a path specifier may be resolved with, in resolution order. */
const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

/**
 * NodeNext writes an import of `./foo.ts` as `./foo.js`. Each extension maps
 * to the source extensions that emit it.
 */
const NODE_NEXT_REWRITES: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** The literal text of a specifier argument, or undefined when computed. */
function literalTextOf(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  // Vitest 3's typed form, `vi.mock(import("./foo"), factory)`, names the
  // module through an import call rather than a bare string.
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    return literalTextOf(node.arguments[0]);
  }
  return undefined;
}

function isMockCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    (callee.expression.text === "vi" || callee.expression.text === "vitest") &&
    MOCK_METHODS.has(callee.name.text)
  );
}

/**
 * Every module named by a mock call in one file. Pure: takes text, returns
 * call sites, so the rule itself is unit-testable.
 */
export function scanSourceForMockSpecifiers(
  fileName: string,
  sourceText: string,
): MockSpecifierSite[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const sites: MockSpecifierSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isMockCall(node)) {
      sites.push({
        line: lineOf(source, node),
        specifier: literalTextOf(node.arguments[0]),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return sites;
}

/** The name a call expression invokes, for `join(...)` and `path.join(...)` alike. */
function calleeName(node: ts.CallExpression): string | undefined {
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isIdentifier(callee)) return callee.text;
  return undefined;
}

/** The literal path segments a call passes after `__dirname`. */
function pathSegmentsAfterDirname(
  node: ts.CallExpression,
): string[] | undefined {
  const [base, ...rest] = node.arguments;
  if (!base || !ts.isIdentifier(base) || base.text !== "__dirname") {
    return undefined;
  }
  const segments: string[] = [];
  for (const argument of rest) {
    if (!ts.isStringLiteral(argument)) return undefined;
    segments.push(argument.text);
  }
  return segments;
}

/** The string a config's path-building call produces, e.g. `join(__dirname, "./src/")`. */
function pathCallValue(
  node: ts.CallExpression,
  configDir: string,
): string | undefined {
  const name = calleeName(node);
  if (name !== "join" && name !== "resolve") return undefined;

  const segments = pathSegmentsAfterDirname(node);
  if (!segments) return undefined;

  const expanded = resolve(configDir, ...segments);
  // `resolve` drops a trailing separator, and the separator is load-bearing:
  // it is what makes `"~/"` expand to a directory rather than glue the rest
  // of the specifier onto the directory's name.
  return segments.at(-1)?.endsWith("/") ? `${expanded}/` : expanded;
}

/** The key and value of one `"key": value` entry, or undefined for any other shape. */
function simpleEntryOf(
  property: ts.ObjectLiteralElementLike,
): { find: string; value: ts.Expression } | undefined {
  if (!ts.isPropertyAssignment(property)) return undefined;
  const name = property.name;
  if (
    !ts.isStringLiteral(name) &&
    !ts.isIdentifier(name) &&
    !ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return undefined;
  }
  return { find: name.text, value: property.initializer };
}

/** The path one alias entry's value expands to, or undefined when unreadable. */
function aliasReplacementOf(
  value: ts.Expression,
  configDir: string,
): string | undefined {
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isCallExpression(value)) return pathCallValue(value, configDir);
  return undefined;
}

/**
 * The module-alias table one vitest config declares.
 *
 * Throws on an entry it cannot read rather than skipping it: an alias the
 * scanner silently drops turns every specifier using it into a false
 * failure, or hides a real one behind a bare-package skip.
 */
export function parseVitestConfigAliases({
  fileName,
  sourceText,
  configDir,
}: {
  fileName: string;
  sourceText: string;
  configDir: string;
}): ModuleAlias[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const aliases: ModuleAlias[] = [];

  const readEntry = (property: ts.ObjectLiteralElementLike): ModuleAlias => {
    const entry = simpleEntryOf(property);
    if (!entry) {
      throw new Error(
        `${fileName}: alias entry is not a simple "key": value pair`,
      );
    }
    const replacement = aliasReplacementOf(entry.value, configDir);
    if (replacement === undefined) {
      throw new Error(
        `${fileName}: alias "${entry.find}" is built in a way this scanner cannot read`,
      );
    }
    return { find: entry.find, replacement };
  };

  const readTable = (table: ts.ObjectLiteralExpression): void => {
    for (const property of table.properties) {
      aliases.push(readEntry(property));
    }
  };

  // `resolve.alias` and `test.alias` are both honoured by vitest, so take
  // the table wherever it is declared.
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "alias" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      readTable(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return aliases;
}

/**
 * Whether one alias entry claims a specifier, on vite's rule: an exact hit,
 * or a prefix that ends at a path boundary. The boundary is what keeps
 * `"@"` (the SDK's alias for its own `src`) from claiming
 * `@opentelemetry/api`.
 */
function aliasMatches(find: string, specifier: string): boolean {
  if (specifier === find) return true;
  return specifier.startsWith(find.endsWith("/") ? find : `${find}/`);
}

/** Apply the alias table, longest find first so the most specific one wins. */
function applyAliases(specifier: string, aliases: ModuleAlias[]): string {
  const ordered = [...aliases].sort((a, b) => b.find.length - a.find.length);
  for (const { find, replacement } of ordered) {
    if (aliasMatches(find, specifier)) {
      return replacement + specifier.slice(find.length);
    }
  }
  return specifier;
}

/** Every file path one resolved base could name, in resolution order. */
function candidatesFor(base: string): string[] {
  const candidates = [base];

  const dot = base.lastIndexOf(".");
  const slash = base.lastIndexOf("/");
  const extension = dot > slash ? base.slice(dot) : "";
  for (const rewritten of NODE_NEXT_REWRITES[extension] ?? []) {
    candidates.push(base.slice(0, dot) + rewritten);
  }

  for (const extension_ of EXTENSIONS) candidates.push(base + extension_);
  for (const extension_ of EXTENSIONS) {
    candidates.push(`${base}/index${extension_}`);
  }

  return candidates;
}

const fileOnDisk = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Where one mock specifier lands, given the aliases in force where it sits. */
export function resolveMockSpecifier({
  specifier,
  fromDir,
  aliases,
  fileExists = fileOnDisk,
}: {
  specifier: string | undefined;
  fromDir: string;
  aliases: ModuleAlias[];
  fileExists?: (path: string) => boolean;
}): MockSpecifierResolution {
  if (specifier === undefined) return { kind: "dynamic" };

  const aliased = applyAliases(specifier, aliases);
  const base = isAbsolute(aliased)
    ? aliased
    : aliased.startsWith(".")
      ? resolve(fromDir, aliased)
      : undefined;
  // A bare specifier is a package name: node resolves it, and whether it is
  // installed is not this scanner's question.
  if (base === undefined) return { kind: "package" };

  const candidates = candidatesFor(base);
  for (const candidate of candidates) {
    if (fileExists(candidate)) return { kind: "resolved", file: candidate };
  }
  return { kind: "missing", candidates };
}

/**
 * The alias table in force for a file: the nearest vitest config above it
 * wins, because that is the config whose resolver would run its suite.
 */
export function aliasesForFile({
  file,
  aliasesByConfigDir,
}: {
  file: string;
  aliasesByConfigDir: Map<string, ModuleAlias[]>;
}): ModuleAlias[] {
  let directory = dirname(file);
  for (;;) {
    const found = aliasesByConfigDir.get(directory);
    if (found) return found;
    const parent = dirname(directory);
    if (parent === directory) return [];
    directory = parent;
  }
}
