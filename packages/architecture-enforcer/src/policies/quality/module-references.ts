import ts from "typescript";

import { readSourceOnce } from "../../workspace/module-graph.ts";

/** The marker a whole-module reference records in place of a member name. */
export const EVERY_NAME = "*";

/** The name a default export is imported under. */
export const DEFAULT_NAME = "default";

/** One static `import`/`export ... from` naming a literal specifier, and the names it takes. */
export type StaticReference = { specifier: string; names: string[] };

/** What one file reads from others, and what it publishes when its exports are checked. */
export type FileReferences = { statics: StaticReference[]; exported?: string[] };

/** What a clause element takes: the name at the source, not the local alias. */
function takenName(element: ts.ImportSpecifier | ts.ExportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

function importedNames(clause: ts.ImportClause | undefined): string[] {
  if (clause === void 0) return [];

  const names = clause.name === void 0 ? [] : [DEFAULT_NAME];
  const bindings = clause.namedBindings;
  if (bindings === void 0) return names;

  if (ts.isNamespaceImport(bindings)) return [...names, EVERY_NAME];

  return [...names, ...bindings.elements.map(takenName)];
}

function reexportedTakenNames(statement: ts.ExportDeclaration): string[] {
  const clause = statement.exportClause;
  if (clause === void 0 || !ts.isNamedExports(clause)) return [EVERY_NAME];

  return clause.elements.map(takenName);
}

function literalReference(
  specifier: ts.Expression | undefined,
  names: string[],
): StaticReference[] {
  if (specifier === void 0 || !ts.isStringLiteralLike(specifier)) return [];

  return [{ specifier: specifier.text, names }];
}

function staticReferences(statement: ts.Statement): StaticReference[] {
  if (ts.isImportDeclaration(statement)) {
    return literalReference(statement.moduleSpecifier, importedNames(statement.importClause));
  }

  if (!ts.isExportDeclaration(statement)) return [];

  return literalReference(statement.moduleSpecifier, reexportedTakenNames(statement));
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];

  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
}

function isExported(statement: ts.Statement): boolean {
  if (!ts.canHaveModifiers(statement)) return false;

  const modifiers = ts.getModifiers(statement) ?? [];

  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** The name a declaration statement publishes, one statement kind at a time. */
function declaredName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text;

  if (ts.isClassDeclaration(statement)) return statement.name?.text;

  if (ts.isInterfaceDeclaration(statement)) return statement.name.text;

  if (ts.isTypeAliasDeclaration(statement)) return statement.name.text;

  if (ts.isEnumDeclaration(statement)) return statement.name.text;

  if (!ts.isModuleDeclaration(statement)) return void 0;

  return ts.isIdentifier(statement.name) ? statement.name.text : void 0;
}

/**
 * A star re-export republishes names this file never spells; there is nothing
 * here to report, and the module it names is checked itself.
 */
function reexportedNames(statement: ts.ExportDeclaration): string[] {
  const clause = statement.exportClause;
  if (clause === void 0) return [];

  if (!ts.isNamedExports(clause)) return [];

  return clause.elements.map((element) => element.name.text);
}

function exportedNamesIn(statement: ts.Statement): string[] {
  if (ts.isExportAssignment(statement)) {
    return statement.isExportEquals === true ? [] : [DEFAULT_NAME];
  }

  if (ts.isExportDeclaration(statement)) return reexportedNames(statement);

  if (!isExported(statement)) return [];

  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((one) => boundNames(one.name));
  }

  const name = declaredName(statement);

  return name === void 0 ? [] : [name];
}

/** Every name this file publishes, whatever a reader would have to write to take it. */
export function exportedNamesFrom(statements: readonly ts.Statement[]): string[] {
  return [...new Set(statements.flatMap((statement) => exportedNamesIn(statement)))];
}

/** One parse of `file`, not retained: the references it makes and, if `declared`, its exports. */
export function readFileReferences({
  file,
  declared,
}: {
  file: string;
  declared: boolean;
}): FileReferences {
  return readSourceOnce({
    file,
    read: ({ statements }) => ({
      statics: statements.flatMap(staticReferences),
      ...(declared ? { exported: exportedNamesFrom(statements) } : {}),
    }),
  });
}
