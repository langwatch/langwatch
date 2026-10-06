// Declaration lookup and value folding for the readmegen extractor: follows a
// name through local constants, imports and re-exports, the way the enforcer's
// readers do, and folds a leaf to the environment variable it reads.
import { relative } from "node:path";

import { sourceFile, type WorkspaceModuleResolver } from "@langwatch/architecture-enforcer";
import ts from "typescript";

const MAX_DEPTH = 8;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENV_CALLEE = /(?:^|\.)(?:env|load|leaf|secret)$/;
const MAX_TEXT = 90;

/** A position in the tree, relative to the workspace root. */
export type At = { file: string; line: number };

/** A value as read: folded when `resolved`, else the source text it stands for. */
export type Folded = { value: string; text: string; resolved: boolean };

/** A declaration found by name: a variable's initialiser or the declaration itself. */
export type Found = { node: ts.Node; source: ts.SourceFile };

export type Reading = { root: string; resolver: WorkspaceModuleResolver };

export function at({
  node,
  source,
  reading,
}: {
  node: ts.Node;
  source: ts.SourceFile;
  reading: Reading;
}): At {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  return { file: relative(reading.root, source.fileName), line };
}

const WRAPPERS = new Set([
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.NonNullExpression,
]);

export function unwrap(expression: ts.Expression): ts.Expression {
  if (!WRAPPERS.has(expression.kind)) return expression;

  return unwrap((expression as ts.ParenthesizedExpression).expression);
}

/** Source text on one line, cut to a readable length. */
export function textOf({ node, source }: { node: ts.Node; source: ts.SourceFile }): string {
  const text = node.getText(source).replace(/\s+/g, " ").trim();

  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** The value `name` holds in a `const`, plain or destructured. */
function variableValue({
  statement,
  name,
}: {
  statement: ts.VariableStatement;
  name: string;
}): ts.Node | undefined {
  for (const declaration of statement.declarationList.declarations) {
    const value = declaration.initializer;
    if (!value) continue;

    const plain = ts.isIdentifier(declaration.name) && declaration.name.text === name;
    if (plain) return value;
    if (destructures({ pattern: declaration.name, name }))
      return memberOf({ node: value, name }) ?? value;
  }

  return void 0;
}

function localDeclaration({
  source,
  name,
}: {
  source: ts.SourceFile;
  name: string;
}): ts.Node | undefined {
  for (const statement of source.statements) {
    const variable = ts.isVariableStatement(statement)
      ? variableValue({ statement, name })
      : void 0;
    if (variable) return variable;

    const named =
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement);
    if (named && statement.name?.text === name) return statement;
  }

  return void 0;
}

function destructures({ pattern, name }: { pattern: ts.BindingName; name: string }): boolean {
  if (!ts.isObjectBindingPattern(pattern)) return false;

  return pattern.elements.some(
    (element) => (element.propertyName ?? element.name).getText() === name,
  );
}

/** The object a `Config.define((c) => ({ … }))` call returns, or the literal itself. */
export function definedObject(node: ts.Node): ts.ObjectLiteralExpression | undefined {
  const call = ts.isExpression(node) ? unwrap(node) : node;
  if (ts.isObjectLiteralExpression(call)) return call;
  if (!ts.isCallExpression(call)) return void 0;

  const [first] = call.arguments;
  const argument = first ? unwrap(first) : void 0;
  if (argument && ts.isObjectLiteralExpression(argument)) return argument;
  if (!argument || !(ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)))
    return void 0;

  const body = argument.body;
  const returned = ts.isBlock(body) ? body.statements.find(ts.isReturnStatement)?.expression : body;
  const value = returned ? unwrap(returned) : void 0;

  return value && ts.isObjectLiteralExpression(value) ? value : void 0;
}

/** The initialiser of property `name` in the object `node` is or defines. */
function memberOf({ node, name }: { node: ts.Node; name: string }): ts.Expression | undefined {
  const literal = definedObject(node);
  const property = literal?.properties.find((item) => item.name?.getText() === name);
  if (property && ts.isPropertyAssignment(property)) return property.initializer;

  return property && ts.isShorthandPropertyAssignment(property) ? property.name : void 0;
}

function follow({
  name,
  specifier,
  from,
  reading,
  depth,
}: {
  name: string;
  specifier: string;
  from: ts.SourceFile;
  reading: Reading;
  depth: number;
}): Found | undefined {
  const file = reading.resolver.resolve({ specifier, file: from.fileName });
  if (!file || !SOURCE_FILE.test(file)) return void 0;

  return findDeclaration({ name, source: sourceFile({ file }), reading, depth: depth + 1 });
}

function viaStatement({
  statement,
  name,
  source,
  reading,
  depth,
}: {
  statement: ts.Statement;
  name: string;
  source: ts.SourceFile;
  reading: Reading;
  depth: number;
}): Found | undefined {
  const isImport = ts.isImportDeclaration(statement);
  const isExport = ts.isExportDeclaration(statement);
  const specifier = isImport || isExport ? statement.moduleSpecifier : void 0;
  if (!specifier || !ts.isStringLiteral(specifier)) return void 0;

  const step = { specifier: specifier.text, from: source, reading, depth };
  const bindings = isImport ? statement.importClause?.namedBindings : void 0;
  const clause = isExport ? statement.exportClause : void 0;
  const elements =
    (bindings && ts.isNamedImports(bindings) ? bindings.elements : void 0) ??
    (clause && ts.isNamedExports(clause) ? clause.elements : void 0);
  const element = elements?.find((item) => item.name.text === name);

  if (element) return follow({ ...step, name: (element.propertyName ?? element.name).text });

  return isExport && !clause ? follow({ ...step, name }) : void 0;
}

/** Where `name` is declared, following imports and re-exports across the workspace. */
export function findDeclaration({
  name,
  source,
  reading,
  depth = 0,
}: {
  name: string;
  source: ts.SourceFile;
  reading: Reading;
  depth?: number;
}): Found | undefined {
  if (depth > MAX_DEPTH) return void 0;

  const local = localDeclaration({ source, name });
  if (local) return { node: local, source };

  for (const statement of source.statements) {
    const found = viaStatement({ statement, name, source, reading, depth });
    if (found) return found;
  }

  return void 0;
}

/** The first environment variable a call inside `node` names, e.g. `c.env("X", …)`. */
export function envNameIn({
  node,
  source,
}: {
  node: ts.Node;
  source: ts.SourceFile;
}): string | undefined {
  let found: string | undefined;

  const visit = (child: ts.Node): void => {
    if (found) return;

    if (ts.isCallExpression(child)) {
      const [first] = child.arguments;
      const callee = child.expression.getText(source);
      if (first && ts.isStringLiteralLike(first) && ENV_NAME.test(first.text))
        if (ENV_CALLEE.test(callee)) found = first.text;
    }

    ts.forEachChild(child, visit);
  };
  visit(node);

  return found;
}

/** A config or secret leaf folded to the environment variable it reads. */
export function foldLeaf({
  expression,
  source,
  reading,
}: {
  expression: ts.Expression;
  source: ts.SourceFile;
  reading: Reading;
}): Folded {
  const value = unwrap(expression);
  const text = textOf({ node: value, source });
  const direct = envNameIn({ node: value, source });
  if (direct) return { value: direct, text, resolved: true };

  const base = ts.isPropertyAccessExpression(value) ? value.expression : value;
  const found = ts.isIdentifier(base)
    ? findDeclaration({ name: base.text, source, reading })
    : void 0;
  const member =
    found && ts.isPropertyAccessExpression(value)
      ? memberOf({ node: found.node, name: value.name.text })
      : found?.node;
  const folded = found && member && envNameIn({ node: member, source: found.source });

  return folded ? { value: folded, text, resolved: true } : { value: "", text, resolved: false };
}
