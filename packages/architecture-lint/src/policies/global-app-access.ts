import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { walkFiles } from "../workspace/layout.ts";
import { sourceText } from "../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";
import type { ArchitectureViolation } from "../types.ts";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const BASELINE_PATH = "packages/architecture-lint/src/global-app-access-baseline.json";
// The global accessor the rule forbids. Both the file and the alias belonged to
// the deleted platform application; neither resolves any more, which is exactly
// the state the rule wants — nothing can import what does not exist. They are
// kept as the STRINGS the scan matches so a reintroduction under either name is
// caught the moment it lands, rather than silently allowed by a rule that
// stopped naming anything.
const ACCESSOR_FILE = "platform/app/src/server/app-layer/app.ts";
const ACCESSOR_ALIAS = "~/server/app-layer/app";
const SYMBOLS = ["getApp", "tryGetApp"] as const;
const SOURCE_ROOTS = ["apps", "mcp/typescript", "packages", "tools"] as const;

type ForbiddenSymbol = (typeof SYMBOLS)[number];
type AccessKind = "import" | "reference";
type BaselineEntry = readonly [string, ForbiddenSymbol, AccessKind, string];
type Binding = { symbol: ForbiddenSymbol; declaration: ts.Identifier };

export type GlobalAppAccess = {
  file: string;
  symbol: ForbiddenSymbol;
  kind: AccessKind;
  localName: string;
  line: number;
  fingerprint: string;
};

const baselineEntrySchema = z.tuple([
  z.string(),
  z.enum(SYMBOLS),
  z.enum(["import", "reference"]),
  z.string().regex(/^[0-9a-f]{16}$/),
]);
const baselineSchema = z.object({ version: z.literal(1), accesses: z.array(z.unknown()) }).strict();

function workspacePath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

function isProductionSource(file: string): boolean {
  return (
    SOURCE_FILE.test(file) &&
    !TEST_SOURCE.test(file) &&
    !file.includes(`${sep}__tests__${sep}`) &&
    !file.includes(`${sep}__mocks__${sep}`)
  );
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;

  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;

  const isPlainJs = file.endsWith(".mjs") || file.endsWith(".cjs");
  if (isPlainJs) return ts.ScriptKind.JS;

  return ts.ScriptKind.TS;
}

function symbolNamed(name: string): ForbiddenSymbol | undefined {
  return SYMBOLS.includes(name as ForbiddenSymbol) ? (name as ForbiddenSymbol) : void 0;
}

function bindingNames(name: ts.BindingName): readonly ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];

  const identifiers: ts.Identifier[] = [];
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) identifiers.push(...bindingNames(element.name));
  }

  return identifiers;
}

function isPropertyName(node: ts.Identifier): boolean {
  return (
    (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
    (ts.isPropertyAssignment(node.parent) &&
      node.parent.name === node &&
      node.parent.initializer !== node) ||
    (ts.isPropertyDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isMethodDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isPropertySignature(node.parent) && node.parent.name === node) ||
    (ts.isMethodSignature(node.parent) && node.parent.name === node) ||
    (ts.isQualifiedName(node.parent) && node.parent.right === node) ||
    (ts.isBindingElement(node.parent) && node.parent.propertyName === node)
  );
}

function isBindingName(node: ts.Identifier): boolean {
  return (
    (ts.isVariableDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isBindingElement(node.parent) && node.parent.name === node) ||
    (ts.isParameter(node.parent) && node.parent.name === node) ||
    (ts.isFunctionDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isFunctionExpression(node.parent) && node.parent.name === node) ||
    (ts.isClassDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isClassExpression(node.parent) && node.parent.name === node) ||
    (ts.isEnumDeclaration(node.parent) && node.parent.name === node)
  );
}

type UnwrappableExpression =
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.TypeAssertion
  | ts.NonNullExpression
  | ts.SatisfiesExpression
  | ts.AwaitExpression;

function isUnwrappable(node: ts.Expression): node is UnwrappableExpression {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node)
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  if (isUnwrappable(node)) return unwrap(node.expression);

  return node;
}

function moduleSpecifier(node: ts.Expression): string | undefined {
  const expression = unwrap(node);
  if (!ts.isCallExpression(expression)) return void 0;
  if (expression.arguments.length !== 1) return void 0;

  const argument = expression.arguments[0];
  if (!argument || !ts.isStringLiteral(argument)) return void 0;

  if (expression.expression.kind === ts.SyntaxKind.ImportKeyword) return argument.text;

  return ts.isIdentifier(expression.expression) && expression.expression.text === "require"
    ? argument.text
    : void 0;
}

function isAccessorModule(root: string, file: string, specifier: string): boolean {
  if (specifier === ACCESSOR_ALIAS) return true;

  if (!specifier.startsWith(".")) return false;

  const candidate = resolve(dirname(file), specifier);

  return [candidate, `${candidate}.ts`, join(candidate, "index.ts")].some(
    (path) => workspacePath(root, path) === ACCESSOR_FILE,
  );
}

function propertySymbol(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): ForbiddenSymbol | undefined {
  if (ts.isPropertyAccessExpression(node)) return symbolNamed(node.name.text);

  return node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
    ? symbolNamed(node.argumentExpression.text)
    : void 0;
}

function isStatementLike(node: ts.Node): boolean {
  return ts.isStatement(node) || ts.isImportDeclaration(node);
}

function accessFingerprint(
  source: ts.SourceFile,
  node: ts.Node,
  symbol: ForbiddenSymbol,
  kind: AccessKind,
): string {
  let context = node;
  while (context.parent && !isStatementLike(context.parent)) context = context.parent;

  if (context.parent && isStatementLike(context.parent)) context = context.parent;

  const normalized = context.getText(source).replace(/\s+/g, " ").trim();
  const prefix = source.text
    .slice(context.getStart(source), node.getStart(source))
    .replace(/\s+/g, " ")
    .trim();

  return createHash("sha256")
    .update(`${kind}\0${symbol}\0${normalized}\0${prefix}`)
    .digest("hex")
    .slice(0, 16);
}

function occurrenceFingerprint(base: string, ordinal: number): string {
  return createHash("sha256").update(`${base}\0${ordinal}`).digest("hex").slice(0, 16);
}

function statementDeclares(node: ts.Node, name: string): boolean {
  const visit = (item: ts.Node): boolean => {
    if (item !== node && ts.isFunctionLike(item)) return false;

    const declaresLocalVariable =
      ts.isVariableDeclaration(item) &&
      bindingNames(item.name).some((identifier) => identifier.text === name);
    if (declaresLocalVariable) return true;

    const declaresLocalNamed =
      (ts.isFunctionDeclaration(item) ||
        ts.isClassDeclaration(item) ||
        ts.isEnumDeclaration(item)) &&
      item.name?.text === name;
    if (declaresLocalNamed) return true;

    let found = false;
    ts.forEachChild(item, (child) => {
      found ||= visit(child);
    });

    return found;
  };

  return visit(node);
}

function isShadowedByParameter(parent: ts.Node, name: string): boolean {
  return (
    ts.isFunctionLike(parent) &&
    parent.parameters.some((parameter) =>
      bindingNames(parameter.name).some((identifier) => identifier.text === name),
    )
  );
}

function isShadowedByCatchClause(parent: ts.Node, name: string): boolean {
  return (
    ts.isCatchClause(parent) &&
    parent.variableDeclaration !== undefined &&
    bindingNames(parent.variableDeclaration.name).some((identifier) => identifier.text === name)
  );
}

function isBlockOrSourceFile(node: ts.Node): node is ts.Block | ts.SourceFile {
  return ts.isBlock(node) || ts.isSourceFile(node);
}

/** Whether an enclosing block/source-file declares `node`'s name before it, outside `binding`. */
function isShadowedByBlockDeclaration(
  parent: ts.Node,
  node: ts.Identifier,
  binding: Binding,
): boolean {
  if (!isBlockOrSourceFile(parent)) return false;

  for (const statement of parent.statements) {
    const isAfterNode = statement.getStart() > node.getStart();
    if (isAfterNode) continue;

    const containsImportedBinding =
      binding.declaration.getStart() >= statement.getStart() &&
      binding.declaration.getEnd() <= statement.getEnd();
    if (statementDeclares(statement, node.text) && !containsImportedBinding) {
      return true;
    }
  }

  return false;
}

function isShadowed(node: ts.Identifier, binding: Binding): boolean {
  let child: ts.Node = node;
  while (child.parent) {
    const parent = child.parent;
    if (isShadowedByParameter(parent, node.text)) return true;
    if (isShadowedByCatchClause(parent, node.text)) return true;
    if (isShadowedByBlockDeclaration(parent, node, binding)) return true;

    child = parent;
  }

  return false;
}

function sourceFiles(root: string): string[] {
  try {
    return execFileSync(
      "rg",
      [
        "--files-with-matches",
        "--no-messages",
        "--glob",
        "*.{ts,tsx,js,jsx,mts,mtsx,cts,ctsx,mjs,cjs}",
        "\\b(getApp|tryGetApp)\\b",
        ...SOURCE_ROOTS,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split("\n")
      .filter(Boolean)
      .map((file) => join(root, file))
      .filter(isProductionSource)
      .sort();
  } catch {
    return SOURCE_ROOTS.flatMap((sourceRoot) =>
      walkFiles(join(root, sourceRoot), isProductionSource).filter((file) => {
        const text = sourceText({ file });

        return SYMBOLS.some((symbol) => text.includes(symbol));
      }),
    );
  }
}

type FileAccessContext = {
  root: string;
  file: string;
  source: ts.SourceFile;
  direct: Map<string, Binding>;
  namespaces: Map<string, Binding>;
  accesses: GlobalAppAccess[];
  fingerprintOccurrences: Map<string, number>;
};

function recordAccess(
  ctx: FileAccessContext,
  node: ts.Node,
  symbol: ForbiddenSymbol,
  kind: AccessKind,
  localName: string = symbol,
): void {
  const baseFingerprint = accessFingerprint(ctx.source, node, symbol, kind);
  const ordinal = ctx.fingerprintOccurrences.get(baseFingerprint) ?? 0;
  ctx.fingerprintOccurrences.set(baseFingerprint, ordinal + 1);
  ctx.accesses.push({
    file: workspacePath(ctx.root, ctx.file),
    symbol,
    kind,
    localName,
    line: ctx.source.getLineAndCharacterOfPosition(node.getStart(ctx.source)).line + 1,
    fingerprint: occurrenceFingerprint(baseFingerprint, ordinal),
  });
}

/** Whether `expression` refers to the accessor module directly, or through a tracked namespace. */
function isAccessorReference(
  ctx: FileAccessContext,
  expression: ts.Expression,
  specifier: string | undefined,
): boolean {
  if (specifier !== void 0 && isAccessorModule(ctx.root, ctx.file, specifier)) return true;
  if (!ts.isIdentifier(expression)) return false;

  const namespace = ctx.namespaces.get(expression.text);

  return namespace !== void 0 && !isShadowed(expression, namespace);
}

function trackDestructuredBindingElement(ctx: FileAccessContext, element: ts.BindingElement): void {
  if (element.dotDotDotToken || !ts.isIdentifier(element.name)) return;

  const property = element.propertyName;
  const isNamedProperty =
    property !== undefined && (ts.isIdentifier(property) || ts.isStringLiteral(property));
  const symbol = symbolNamed(isNamedProperty ? property.text : element.name.text);
  if (!symbol) return;

  ctx.direct.set(element.name.text, { symbol, declaration: element.name });
  recordAccess(ctx, element.name, symbol, "import", element.name.text);
}

function trackDestructuredBindings(
  ctx: FileAccessContext,
  name: ts.BindingName,
  initializer: ts.Expression,
): void {
  const specifier = moduleSpecifier(initializer);
  const expression = unwrap(initializer);
  const fromAccessor = isAccessorReference(ctx, expression, specifier);
  if (!fromAccessor) return;

  if (ts.isIdentifier(name)) {
    ctx.namespaces.set(name.text, { symbol: "getApp", declaration: name });

    return;
  }

  for (const element of name.elements) {
    if (!ts.isBindingElement(element)) continue;

    trackDestructuredBindingElement(ctx, element);
  }
}

function trackImportStatement(ctx: FileAccessContext, statement: ts.ImportDeclaration): void {
  const clause = statement.importClause;
  if (!clause) return;
  if (clause.isTypeOnly) return;
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
  if (!isAccessorModule(ctx.root, ctx.file, statement.moduleSpecifier.text)) return;

  const namedBindings = clause.namedBindings;
  if (!namedBindings) return;

  if (ts.isNamespaceImport(namedBindings)) {
    ctx.namespaces.set(namedBindings.name.text, {
      symbol: "getApp",
      declaration: namedBindings.name,
    });

    return;
  }

  for (const element of namedBindings.elements) {
    if (element.isTypeOnly) continue;

    const symbol = symbolNamed(element.propertyName?.text ?? element.name.text);
    if (!symbol) continue;

    ctx.direct.set(element.name.text, { symbol, declaration: element.name });
    recordAccess(ctx, element.name, symbol, "import", element.name.text);
  }
}

function trackExportStatement(ctx: FileAccessContext, statement: ts.ExportDeclaration): void {
  if (statement.isTypeOnly) return;

  const module = statement.moduleSpecifier;
  if (!module) return;
  if (!ts.isStringLiteral(module)) return;

  const clause = statement.exportClause;
  if (!clause) return;
  if (!ts.isNamedExports(clause)) return;
  if (!isAccessorModule(ctx.root, ctx.file, module.text)) return;

  for (const element of clause.elements) {
    if (element.isTypeOnly) continue;

    const symbol = symbolNamed(element.propertyName?.text ?? element.name.text);
    if (symbol) recordAccess(ctx, element.name, symbol, "import", element.name.text);
  }
}

function trackTopLevelStatement(ctx: FileAccessContext, statement: ts.Statement): void {
  if (ts.isImportDeclaration(statement)) trackImportStatement(ctx, statement);

  if (ts.isExportDeclaration(statement)) trackExportStatement(ctx, statement);
}

function trackPropertyOrElementAccess(
  ctx: FileAccessContext,
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): void {
  const symbol = propertySymbol(node);
  if (!symbol) return;

  const expression = unwrap(node.expression);
  const specifier = moduleSpecifier(expression);
  const isAccessor = isAccessorReference(ctx, expression, specifier);
  if (isAccessor) recordAccess(ctx, node, symbol, "reference", node.getText(ctx.source));
}

function trackIdentifierReference(ctx: FileAccessContext, node: ts.Identifier): void {
  const isDeclarationName = isPropertyName(node) || isBindingName(node);
  if (isDeclarationName) return;

  const binding = ctx.direct.get(node.text);
  if (!binding) return;
  if (isShadowed(node, binding)) return;

  recordAccess(ctx, node, binding.symbol, "reference", node.text);
}

function isPropertyOrElementAccess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

function visitFileAccessNode(ctx: FileAccessContext, node: ts.Node): void {
  const isImportOrExport = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
  if (isImportOrExport) return;

  if (ts.isVariableDeclaration(node) && node.initializer) {
    trackDestructuredBindings(ctx, node.name, node.initializer);
  }

  if (isPropertyOrElementAccess(node)) {
    trackPropertyOrElementAccess(ctx, node);
  }

  if (ts.isIdentifier(node)) {
    trackIdentifierReference(ctx, node);
  }
}

function collectFileAccesses(root: string, file: string, sourceText: string): GlobalAppAccess[] {
  if (workspacePath(root, file) === ACCESSOR_FILE) return [];

  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const ctx: FileAccessContext = {
    root,
    file,
    source,
    direct: new Map(),
    namespaces: new Map(),
    accesses: [],
    fingerprintOccurrences: new Map(),
  };

  for (const statement of source.statements) {
    trackTopLevelStatement(ctx, statement);
  }

  const visit = (node: ts.Node): void => {
    visitFileAccessNode(ctx, node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  return ctx.accesses.sort(
    (left, right) =>
      left.line - right.line ||
      left.kind.localeCompare(right.kind) ||
      left.localName.localeCompare(right.localName) ||
      left.fingerprint.localeCompare(right.fingerprint),
  );
}

export function collectGlobalAppAccesses(root: string): GlobalAppAccess[] {
  return sourceFiles(root).flatMap((file) =>
    collectFileAccesses(root, file, sourceText({ file })),
  );
}

function entry(access: GlobalAppAccess): BaselineEntry {
  return [access.file, access.symbol, access.kind, access.fingerprint];
}

function key(entry: BaselineEntry): string {
  return entry.join("\0");
}

export function formatGlobalAppAccessBaseline(accesses: readonly GlobalAppAccess[]): string {
  const entries = accesses.map(entry).sort((left, right) => key(left).localeCompare(key(right)));

  return `${JSON.stringify({ version: 1, accesses: entries }, null, 2)}\n`;
}

function readBaseline(root: string): {
  entries: BaselineEntry[];
  violations: ArchitectureViolation[];
} {
  const file = join(root, BASELINE_PATH);
  if (!existsSync(file)) return { entries: [], violations: [] };

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      entries: [],
      violations: [
        {
          policy: "global-app-access-baseline",
          file,
          message: `Global app access baseline must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const document = baselineSchema.safeParse(value);
  if (!document.success)
    return {
      entries: [],
      violations: [
        {
          policy: "global-app-access-baseline",
          file,
          message: "Global app access baseline must contain version 1 and an accesses array.",
        },
      ],
    };

  const entries: BaselineEntry[] = [];
  const violations: ArchitectureViolation[] = [];
  for (const [index, value] of document.data.accesses.entries()) {
    const result = baselineEntrySchema.safeParse(value);
    if (result.success) entries.push(result.data);
    else
      violations.push({
        policy: "global-app-access-baseline",
        file,
        message: `Global app access baseline entry ${index} is malformed.`,
      });
  }

  const sorted = [...entries].sort((left, right) => key(left).localeCompare(key(right)));
  const isUnsorted = entries.some((item, index) => key(item) !== key(sorted[index]!));
  if (isUnsorted)
    violations.push({
      policy: "global-app-access-baseline",
      file,
      message: "Global app access baseline entries must be sorted.",
    });

  if (new Set(entries.map(key)).size !== entries.length)
    violations.push({
      policy: "global-app-access-baseline",
      file,
      message: "Global app access baseline entries must be unique.",
    });

  return { entries, violations };
}

export function lintGlobalAppAccess(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;

  const current = collectGlobalAppAccesses(root);
  const { entries, violations } = readBaseline(root);
  const baseline = new Set(entries.map(key));
  const currentKeys = new Set(current.map((access) => key(entry(access))));
  for (const access of current) {
    const isBaselined = baseline.has(key(entry(access)));
    if (isBaselined) continue;

    violations.push({
      policy: "global-app-access",
      file: join(root, access.file),
      line: access.line,
      specifier: access.symbol,
      message: `Global service-locator symbol ${access.symbol} is not allowed here.`,
      allowed:
        "Receive the composed service through context or an explicit service constructor dependency; keep getApp/tryGetApp only in the legacy composition accessor while it is being removed.",
    });
  }

  for (const item of entries) {
    const stillExists = currentKeys.has(key(item));
    if (stillExists) continue;

    violations.push({
      policy: "global-app-access-baseline",
      file: join(root, item[0]),
      specifier: item[1],
      message: `Global app access baseline retains removed ${item[1]} occurrence.`,
      allowed: "Remove the stale baseline entry after the legacy access is removed.",
    });
  }

  return violations;
}
