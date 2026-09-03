import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { walkFiles } from "./files";
import type { ArchitectureViolation } from "./types";

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
  if (file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
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

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node)
  )
    return unwrap(node.expression);
  return node;
}

function moduleSpecifier(node: ts.Expression): string | undefined {
  const expression = unwrap(node);
  const argument = ts.isCallExpression(expression) ? expression.arguments[0] : void 0;
  if (
    !expression ||
    !ts.isCallExpression(expression) ||
    expression.arguments.length !== 1 ||
    !argument ||
    !ts.isStringLiteral(argument)
  )
    return;
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

function accessFingerprint(
  source: ts.SourceFile,
  node: ts.Node,
  symbol: ForbiddenSymbol,
  kind: AccessKind,
): string {
  let context = node;
  while (
    context.parent &&
    !ts.isStatement(context.parent) &&
    !ts.isImportDeclaration(context.parent)
  )
    context = context.parent;
  if (context.parent && (ts.isStatement(context.parent) || ts.isImportDeclaration(context.parent)))
    context = context.parent;
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
    if (
      ts.isVariableDeclaration(item) &&
      bindingNames(item.name).some((identifier) => identifier.text === name)
    )
      return true;
    if (
      (ts.isFunctionDeclaration(item) ||
        ts.isClassDeclaration(item) ||
        ts.isEnumDeclaration(item)) &&
      item.name?.text === name
    )
      return true;
    let found = false;
    ts.forEachChild(item, (child) => {
      found ||= visit(child);
    });
    return found;
  };
  return visit(node);
}

function isShadowed(node: ts.Identifier, binding: Binding): boolean {
  let child: ts.Node = node;
  while (child.parent) {
    const parent = child.parent;
    if (
      ts.isFunctionLike(parent) &&
      parent.parameters.some((parameter) =>
        bindingNames(parameter.name).some((identifier) => identifier.text === node.text),
      )
    )
      return true;
    if (
      ts.isCatchClause(parent) &&
      parent.variableDeclaration &&
      bindingNames(parent.variableDeclaration.name).some(
        (identifier) => identifier.text === node.text,
      )
    )
      return true;
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const statement of parent.statements) {
        if (statement.getStart() > node.getStart()) continue;
        const containsImportedBinding =
          binding.declaration.getStart() >= statement.getStart() &&
          binding.declaration.getEnd() <= statement.getEnd();
        if (statementDeclares(statement, node.text) && !containsImportedBinding) {
          return true;
        }
      }
    }
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
        const text = readFileSync(file, "utf8");
        return SYMBOLS.some((symbol) => text.includes(symbol));
      }),
    );
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
  const direct = new Map<string, Binding>();
  const namespaces = new Map<string, Binding>();
  const accesses: GlobalAppAccess[] = [];
  const fingerprintOccurrences = new Map<string, number>();
  const add = (
    node: ts.Node,
    symbol: ForbiddenSymbol,
    kind: AccessKind,
    localName: string = symbol,
  ): void => {
    const baseFingerprint = accessFingerprint(source, node, symbol, kind);
    const ordinal = fingerprintOccurrences.get(baseFingerprint) ?? 0;
    fingerprintOccurrences.set(baseFingerprint, ordinal + 1);
    accesses.push({
      file: workspacePath(root, file),
      symbol,
      kind,
      localName,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      fingerprint: occurrenceFingerprint(baseFingerprint, ordinal),
    });
  };
  const addDestructuredBindings = (name: ts.BindingName, initializer: ts.Expression): void => {
    const specifier = moduleSpecifier(initializer);
    const expression = unwrap(initializer);
    const namespace = ts.isIdentifier(expression) ? namespaces.get(expression.text) : void 0;
    const fromAccessor =
      (specifier !== void 0 && isAccessorModule(root, file, specifier)) ||
      (ts.isIdentifier(expression) && namespace !== void 0 && !isShadowed(expression, namespace));
    if (!fromAccessor) return;
    if (ts.isIdentifier(name)) {
      namespaces.set(name.text, { symbol: "getApp", declaration: name });
      return;
    }
    for (const element of name.elements) {
      if (!ts.isBindingElement(element)) continue;
      if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
      const property = element.propertyName;
      const symbol = symbolNamed(
        property && (ts.isIdentifier(property) || ts.isStringLiteral(property))
          ? property.text
          : element.name.text,
      );
      if (!symbol) continue;
      direct.set(element.name.text, { symbol, declaration: element.name });
      add(element.name, symbol, "import", element.name.text);
    }
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (
        !clause ||
        clause.isTypeOnly ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !isAccessorModule(root, file, statement.moduleSpecifier.text) ||
        !clause.namedBindings
      )
        continue;
      if (ts.isNamespaceImport(clause.namedBindings)) {
        namespaces.set(clause.namedBindings.name.text, {
          symbol: "getApp",
          declaration: clause.namedBindings.name,
        });
        continue;
      }
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        const symbol = symbolNamed(element.propertyName?.text ?? element.name.text);
        if (!symbol) continue;
        direct.set(element.name.text, { symbol, declaration: element.name });
        add(element.name, symbol, "import", element.name.text);
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const module = statement.moduleSpecifier;
      const clause = statement.exportClause;
      if (
        !module ||
        !ts.isStringLiteral(module) ||
        !clause ||
        !ts.isNamedExports(clause) ||
        !isAccessorModule(root, file, module.text)
      )
        continue;
      for (const element of clause.elements) {
        if (element.isTypeOnly) continue;
        const symbol = symbolNamed(element.propertyName?.text ?? element.name.text);
        if (symbol) add(element.name, symbol, "import", element.name.text);
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isVariableDeclaration(node)) {
      const initializer = node.initializer;
      if (initializer) addDestructuredBindings(node.name, initializer);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const symbol = propertySymbol(node);
      const expression = unwrap(node.expression);
      const specifier = moduleSpecifier(expression);
      const namespace = ts.isIdentifier(expression) ? namespaces.get(expression.text) : void 0;
      const isNamespaceAccess =
        ts.isIdentifier(expression) && namespace !== void 0 && !isShadowed(expression, namespace);
      if (symbol && ((specifier && isAccessorModule(root, file, specifier)) || isNamespaceAccess))
        add(node, symbol, "reference", node.getText(source));
    }
    if (ts.isIdentifier(node) && !isPropertyName(node) && !isBindingName(node)) {
      const binding = direct.get(node.text);
      if (binding && !isShadowed(node, binding)) {
        add(node, binding.symbol, "reference", node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return accesses.sort(
    (left, right) =>
      left.line - right.line ||
      left.kind.localeCompare(right.kind) ||
      left.localName.localeCompare(right.localName) ||
      left.fingerprint.localeCompare(right.fingerprint),
  );
}

export function collectGlobalAppAccesses(root: string): GlobalAppAccess[] {
  return sourceFiles(root).flatMap((file) =>
    collectFileAccesses(root, file, readFileSync(file, "utf8")),
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
  if (entries.some((item, index) => key(item) !== key(sorted[index]!)))
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

export function lintGlobalAppAccess(root: string): ArchitectureViolation[] {
  const current = collectGlobalAppAccesses(root);
  const { entries, violations } = readBaseline(root);
  const baseline = new Set(entries.map(key));
  const currentKeys = new Set(current.map((access) => key(entry(access))));
  for (const access of current) {
    if (baseline.has(key(entry(access)))) continue;
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
    if (currentKeys.has(key(item))) continue;
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
