import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { upStatements } from "./clickhouse-table-ownership.ts";

/**
 * Every goose id index table (`<source>_id_index`, or a second `<source>_by_<key>_index`) has one
 * `defineIdIndex` declaration, and every declaration its goose table and view, so readiness, the
 * fill and every read by id cover the index (dev/docs/plans/id-index-2026-10-10.md).
 */

const POLICY = "id-index-pairing";
const MIGRATIONS = "packages/clickhouse-migrations/migrations";
/** Framework code that declares an index beside the modules: eventing's event log. */
const FRAMEWORK_ROOTS = ["packages/eventing/src"];
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const DEFINE = "defineIdIndex";
const GOOSE_TABLE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\$\{[^}]*\}\.)?`?([A-Za-z_]\w*(?:_id_index|_by_\w+_index))`?(?![\w])/gi;
const GOOSE_VIEW =
  /CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\$\{[^}]*\}\.)?`?([A-Za-z_]\w*(?:_id_index|_by_\w+_index))_mv`?/gi;
const ALLOWED =
  "Declare each id index once with defineIdIndex({ source, key, time }) in its owner, beside the goose file that creates <source>_id_index (or, with by: true, <source>_by_<key>_index) and its _mv view (dev/docs/plans/id-index-2026-10-10.md).";

/** One `defineIdIndex` call: its source table, key columns, index name, and where it is written. */
export type IdIndexDeclarationSite = {
  source: string;
  key: readonly string[];
  index: string;
  file: string;
  line: number;
};

/**
 * Mirrors `idIndexName` in `@langwatch/clickhouse-client`, which this package does not
 * depend on.
 */
export function idIndexNameOf({
  source,
  key,
  by,
}: {
  source: string;
  key: readonly string[];
  by: boolean;
}): string {
  if (!by) return `${source}_id_index`;
  const snake = (column: string) =>
    column
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
      .toLowerCase();
  return `${source}_by_${key.map(snake).join("_")}_index`;
}

/** The roots a declaration may live in: every module, and eventing. */
export function declarationRoots({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): string[] {
  return [...catalogue.map((entry) => entry.root), ...FRAMEWORK_ROOTS]
    .map((directory) => join(root, directory))
    .filter((directory) => existsSync(directory));
}

/** Production source files under the roots, sorted. */
export function sourceFilesUnder({ roots }: { roots: readonly string[] }): string[] {
  return roots
    .flatMap((directory) =>
      listFiles({
        directory,
        accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file),
      }),
    )
    .toSorted();
}

function stringProperty({
  literal,
  name,
}: {
  literal: ts.ObjectLiteralExpression;
  name: string;
}): ts.Expression | undefined {
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === name) {
      return property.initializer;
    }
  }
  return undefined;
}

function declarationOf({
  node,
  source,
}: {
  node: ts.CallExpression;
  source: ts.SourceFile;
}): IdIndexDeclarationSite | undefined {
  const [argument] = node.arguments;
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return undefined;
  const table = stringProperty({ literal: argument, name: "source" });
  const key = stringProperty({ literal: argument, name: "key" });
  if (table === undefined || !ts.isStringLiteralLike(table)) return undefined;
  const columns =
    key !== undefined && ts.isArrayLiteralExpression(key)
      ? key.elements.filter(ts.isStringLiteralLike).map((element) => element.text)
      : [];
  const by = stringProperty({ literal: argument, name: "by" })?.kind === ts.SyntaxKind.TrueKeyword;
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const index = idIndexNameOf({ source: table.text, key: columns, by });
  return { source: table.text, key: columns, index, file: source.fileName, line };
}

/** Every `defineIdIndex({ source: "…", key: [...] })` in the modules and eventing. */
export function collectIdIndexDeclarations({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): IdIndexDeclarationSite[] {
  const found: IdIndexDeclarationSite[] = [];
  for (const file of sourceFilesUnder({ roots: declarationRoots({ root, catalogue }) })) {
    if (!sourceText({ file }).includes(`${DEFINE}(`)) continue;
    const source = sourceFile({ file });
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === DEFINE
      ) {
        const declaration = declarationOf({ node, source });
        if (declaration !== undefined) found.push(declaration);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** Each goose id index table and view, by index name, with the migration that creates it. */
export function gooseIdIndexes({ root }: { root: string }): {
  tables: Map<string, string>;
  views: Map<string, string>;
} {
  const tables = new Map<string, string>();
  const views = new Map<string, string>();
  const directory = join(root, MIGRATIONS);
  if (!existsSync(directory)) return { tables, views };
  for (const name of readdirSync(directory)
    .filter((each) => each.endsWith(".sql"))
    .toSorted()) {
    const file = `${MIGRATIONS}/${name}`;
    const sql = upStatements(readFileSync(join(root, file), "utf8"));
    for (const [, index = ""] of sql.matchAll(GOOSE_TABLE))
      if (!tables.has(index)) tables.set(index, file);
    for (const [, index = ""] of sql.matchAll(GOOSE_VIEW))
      if (!views.has(index)) views.set(index, file);
  }
  return { tables, views };
}

/** The pairing check over a root, for fixtures and the registry entry alike. */
export function lintIdIndexPairingAt({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ArchitectureViolation[] {
  const declarations = collectIdIndexDeclarations({ root, catalogue });
  const { tables, views } = gooseIdIndexes({ root });
  const violations: ArchitectureViolation[] = [];
  const declared = new Map<string, IdIndexDeclarationSite>();
  for (const declaration of declarations) {
    const { index } = declaration;
    const site = {
      policy: POLICY,
      file: declaration.file,
      line: declaration.line,
      allowed: ALLOWED,
    };
    const earlier = declared.get(index);
    if (earlier !== undefined) {
      violations.push({
        ...site,
        message: `${index} is declared twice; the first is at ${earlier.file}:${earlier.line}.`,
      });
      continue;
    }
    declared.set(index, declaration);
    if (!tables.has(index)) {
      violations.push({
        ...site,
        message: `${index} is declared, but no goose migration creates it.`,
      });
    }
    if (!views.has(index)) {
      violations.push({
        ...site,
        message: `${index} is declared, but no goose migration creates its ${index}_mv view.`,
      });
    }
  }
  for (const [index, file] of tables) {
    if (declared.has(index)) continue;
    violations.push({
      policy: POLICY,
      file: join(root, file),
      message: `${index} has no defineIdIndex declaration, so no read, fill or retention raise uses it.`,
      allowed: ALLOWED,
    });
  }
  return violations;
}

/** Every goose id index paired with one declaration, and every declaration with its goose pair. */
export function lintIdIndexPairing(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintIdIndexPairingAt({ root: snapshot.root, catalogue: snapshot.catalogue });
}
