import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ClassifiedPackage } from "../../types.ts";
import { mentionMatcher, sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { moduleOfPath } from "./foreign-error-code.ts";

/**
 * Shared by rules 12b (owner-only-constant) and 12c (contract-tuning-constant) of
 * dev/docs/plans/platform-architecture-blocks.md: which top-level `export const` a contract
 * package declares, and which files outside the owning module import each one by name.
 */

const SCANNED_TREES = ["modules", "enterprise", "apps"] as const;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const TEST_FILE =
  /(?:__tests__|__fixtures__|__mocks__|\/fixtures\/|\/e2e\/|\/testing\/|\.(?:test|spec|stories|fixture|d)\.)/;
const GENERATED = /(?:^|\/)generated\/|\.generated\./;

/** A top-level `export const` of a contract package. */
export type ContractExport = {
  name: string;
  file: string;
  /** The contract package's name, the specifier its importers use. */
  contract: string;
  /** The owning module's directory, e.g. `modules/langy`. */
  module: string;
  /** The text of the comment block above the declaration. */
  comment: string;
  initializer: ts.Expression | undefined;
};

/** A named import (or re-export) of a contract export from a file outside the owning module. */
export type ForeignContractImport = {
  file: string;
  line: number;
  /** The importing module's directory, or the file's own tree (`apps/api`) outside every module. */
  importer: string;
  export: ContractExport;
};

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

function isExported(statement: ts.VariableStatement): boolean {
  return (ts.getModifiers(statement) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

/** The comment block directly above a statement, which is where a JSDoc tag sits. */
function commentAbove({
  source,
  statement,
}: {
  source: ts.SourceFile;
  statement: ts.Node;
}): string {
  const ranges = ts.getLeadingCommentRanges(source.text, statement.pos) ?? [];

  return ranges.map((range) => source.text.slice(range.pos, range.end)).join("\n");
}

/** Whether a comment block carries the JSDoc tag, e.g. `@ownerOnly`, as a tag and not as prose. */
export function hasTag({ comment, tag }: { comment: string; tag: string }): boolean {
  return new RegExp(`^\\s*(?:/\\*\\*|\\*)\\s*@${tag}\\b`, "m").test(comment);
}

/** Every top-level `export const` in a contract package's src that `accept` keeps. */
export function collectContractExports({
  snapshot,
  accept,
}: {
  snapshot: WorkspaceSnapshot;
  accept: (candidate: ContractExport) => boolean;
}): ContractExport[] {
  const { root } = snapshot;
  const found: ContractExport[] = [];
  const contracts = snapshot.packages.filter(
    (pkg): pkg is ClassifiedPackage => pkg.kind === "contract",
  );

  for (const contract of contracts) {
    const path = workspacePath({ root, file: contract.root });
    const module = moduleOfPath(`${path}/`);
    if (module === undefined) continue;

    const files = snapshot.files({
      directory: join(contract.root, "src"),
      accept: isScannedSource,
    });
    for (const file of files) {
      const path = workspacePath({ root, file });
      const candidates = exportedConstsOf({ file, path, contract: contract.name, module });
      found.push(...candidates.filter((candidate) => accept(candidate)));
    }
  }

  return found;
}

/** Non-test, non-generated TypeScript source. */
function isScannedSource(file: string): boolean {
  if (!SOURCE_FILE.test(file)) return false;

  return !TEST_FILE.test(file) && !GENERATED.test(file);
}

function isExportedConst(statement: ts.VariableStatement): boolean {
  if (!isExported(statement)) return false;

  return (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
}

/** Every top-level `export const` one contract source file declares. */
function exportedConstsOf({
  file,
  path,
  contract,
  module,
}: {
  file: string;
  path: string;
  contract: string;
  module: string;
}): ContractExport[] {
  const source = sourceFile({ file, parents: false });
  const statements = source.statements
    .filter(ts.isVariableStatement)
    .filter((statement) => isExportedConst(statement));

  return statements.flatMap((statement) =>
    statement.declarationList.declarations.flatMap((declaration) => {
      if (!ts.isIdentifier(declaration.name)) return [];

      return [
        {
          name: declaration.name.text,
          file: path,
          contract,
          module,
          comment: commentAbove({ source, statement }),
          initializer: declaration.initializer,
        },
      ];
    }),
  );
}

/** The kept contract exports a file outside the owning module imports or re-exports by name. */
export function collectForeignImports({
  snapshot,
  exports,
}: {
  snapshot: WorkspaceSnapshot;
  exports: readonly ContractExport[];
}): ForeignContractImport[] {
  const { root } = snapshot;
  if (exports.length === 0) return [];

  const byKey = new Map(exports.map((entry) => [`${entry.contract}\0${entry.name}`, entry]));
  const contractNames = [...new Set(exports.map((entry) => entry.contract))];
  const mayName = mentionMatcher({ words: exports.map((entry) => entry.name) });
  const found: ForeignContractImport[] = [];

  const contractOf = (specifier: string): string | undefined =>
    contractNames.find((name) => specifier === name || specifier.startsWith(`${name}/`));

  for (const tree of SCANNED_TREES) {
    const directory = join(root, tree);
    if (!existsSync(directory)) continue;

    const files = snapshot.files({ directory, accept: isScannedSource });
    for (const file of files.filter((candidate) => mayName(candidate))) {
      const path = workspacePath({ root, file });
      found.push(...foreignImportsOf({ file, path, byKey, contractOf }));
    }
  }

  return found;
}

/** The module specifier of an import or re-export statement, when it is a string literal. */
function specifierOf(statement: ts.Statement): ts.StringLiteral | undefined {
  const declaration = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
  const specifier = declaration ? statement.moduleSpecifier : undefined;

  return specifier && ts.isStringLiteral(specifier) ? specifier : undefined;
}

/** The value names one import or re-export statement takes, by name or through a namespace. */
function usesOf({
  source,
  statement,
}: {
  source: ts.SourceFile;
  statement: ts.Statement;
}): { name: string; node: ts.Node }[] {
  return [
    ...namedBindingsOf(statement)
      .filter((element) => !element.isTypeOnly)
      .map((element) => ({ name: (element.propertyName ?? element.name).text, node: element })),
    ...namespaceReadsOf({ source, statement }),
  ];
}

/** The kept contract exports one file outside their owning module imports or re-exports. */
function foreignImportsOf({
  file,
  path,
  byKey,
  contractOf,
}: {
  file: string;
  path: string;
  byKey: ReadonlyMap<string, ContractExport>;
  contractOf: (specifier: string) => string | undefined;
}): ForeignContractImport[] {
  const importer = moduleOfPath(path) ?? path.split("/").slice(0, 2).join("/");
  const source = sourceFile({ file, parents: false });
  const found: ForeignContractImport[] = [];

  for (const statement of source.statements) {
    const specifier = specifierOf(statement);
    const contract = specifier === undefined ? undefined : contractOf(specifier.text);
    if (contract === undefined) continue;

    for (const use of usesOf({ source, statement })) {
      const entry = byKey.get(`${contract}\0${use.name}`);
      if (entry === undefined || entry.module === importer) continue;
      found.push({
        file: path,
        line: source.getLineAndCharacterOfPosition(use.node.getStart(source)).line + 1,
        importer,
        export: entry,
      });
    }
  }

  return found;
}

/** `import * as ns from "<contract>"`: every `ns.NAME` read in the file, by member name. */
function namespaceReadsOf({
  source,
  statement,
}: {
  source: ts.SourceFile;
  statement: ts.Statement;
}): { name: string; node: ts.Node }[] {
  if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) return [];
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamespaceImport(bindings)) return [];

  const namespace = bindings.name.text;
  const reads: { name: string; node: ts.Node }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === namespace
    ) {
      reads.push({ name: node.name.text, node });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  return reads;
}

/** The value bindings an import or re-export names; none for a type-only or other statement. */
function namedBindingsOf(
  statement: ts.Statement,
): readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] {
  if (ts.isImportDeclaration(statement)) {
    const bindings = statement.importClause?.namedBindings;
    if (statement.importClause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) return [];

    return bindings.elements;
  }
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause;
    if (statement.isTypeOnly || !clause || !ts.isNamedExports(clause)) return [];

    return clause.elements;
  }

  return [];
}
