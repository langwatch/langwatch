import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { CallExpression, Expression, Node, SourceFile } from "typescript/unstable/ast";
import {
  isCallExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
  SyntaxKind,
} from "typescript/unstable/ast";
import type { ModuleAlias } from "./vitest-alias-table";

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
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

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

function lineOf({ source, node }: { source: SourceFile; node: Node }): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** The literal text of a specifier argument, or undefined when computed. */
function literalTextOf({ node }: { node: Expression | undefined }): string | undefined {
  if (!node) return undefined;
  if (isStringLiteral(node)) return node.text;
  if (isNoSubstitutionTemplateLiteral(node)) return node.text;
  // Vitest 3's typed form, `vi.mock(import("./foo"), factory)`, names the
  // module through an import call rather than a bare string.
  if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
    return literalTextOf({ node: node.arguments[0] });
  }
  return undefined;
}

function isMockCall({ node }: { node: CallExpression }): boolean {
  const callee = node.expression;
  return (
    isPropertyAccessExpression(callee) &&
    isIdentifier(callee.expression) &&
    (callee.expression.text === "vi" || callee.expression.text === "vitest") &&
    MOCK_METHODS.has(callee.name.text)
  );
}

/**
 * Whether a file could hold a mock call at all, as a cheap substring test so
 * a walk parses only the files that might matter.
 *
 * Derived from `MOCK_METHODS` rather than spelled out separately: the method
 * names share no common case-sensitive substring, since `vi.doMock` carries
 * no lowercase "mock". A filter written by hand drifts from the set it is
 * meant to mirror, and the drift is invisible, because the file it wrongly
 * skips is reported clean.
 */
export function mightContainMockCall({ sourceText }: { sourceText: string }): boolean {
  for (const method of MOCK_METHODS) {
    if (sourceText.includes(method)) return true;
  }
  return false;
}

/**
 * Every module named by a mock call in one file. Pure: takes a parsed file,
 * returns call sites, so the rule itself is unit-testable.
 *
 * Parsing is the caller's, not this function's, because it is no longer free:
 * TypeScript 7 parses in the compiler process, and a whole-tree scan that asked
 * per file paid a round trip per file. The callers that walk the tree parse
 * every file in one exchange (`parseSourceTexts`) and hand the results here.
 */
export function scanSourceForMockSpecifiers({
  source,
}: {
  source: SourceFile;
}): MockSpecifierSite[] {
  const sites: MockSpecifierSite[] = [];

  const visit = (node: Node): void => {
    if (isCallExpression(node) && isMockCall({ node })) {
      sites.push({
        line: lineOf({ source, node }),
        specifier: literalTextOf({ node: node.arguments[0] }),
      });
    }
    node.forEachChild(visit);
  };
  visit(source);

  return sites;
}

/**
 * Whether one alias entry claims a specifier, on vite's rule: an exact hit,
 * or a prefix that ends at a path boundary. The boundary is what keeps
 * `"@"` (the SDK's alias for its own `src`) from claiming
 * `@opentelemetry/api`.
 */
function aliasMatches({
  find,
  specifier,
  exact,
}: {
  find: string;
  specifier: string;
  exact?: boolean;
}): boolean {
  if (specifier === find) return true;
  // An anchored entry claims the bare specifier and nothing under it, so a
  // subpath falls through to the package's own `exports` map.
  if (exact) return false;
  return specifier.startsWith(find.endsWith("/") ? find : `${find}/`);
}

/**
 * Apply the alias table in declaration order, first match winning, which is
 * what vite does. Not the longest or most specific match: with
 * `[{ find: "@/" }, { find: "@/generated/" }]` vite resolves
 * `@/generated/x` through `@/`, and a resolver that preferred the longer
 * entry would look for the file somewhere the runner never would.
 */
function applyAliases({
  specifier,
  aliases,
}: {
  specifier: string;
  aliases: ModuleAlias[];
}): string {
  for (const { find, replacement, exact } of aliases) {
    if (aliasMatches({ find, specifier, exact })) {
      return replacement + specifier.slice(find.length);
    }
  }
  return specifier;
}

/** Every file path one resolved base could name, in resolution order. */
function candidatesFor({ base }: { base: string }): string[] {
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

  const aliased = applyAliases({ specifier, aliases });
  const base = isAbsolute(aliased)
    ? aliased
    : aliased.startsWith(".")
      ? resolve(fromDir, aliased)
      : undefined;
  // A bare specifier is a package name: node resolves it, and whether it is
  // installed is not this scanner's question.
  if (base === undefined) return { kind: "package" };

  const candidates = candidatesFor({ base });
  for (const candidate of candidates) {
    if (fileExists(candidate)) return { kind: "resolved", file: candidate };
  }
  return { kind: "missing", candidates };
}
