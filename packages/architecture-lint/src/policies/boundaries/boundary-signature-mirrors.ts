import { join, relative, sep } from "node:path";
import ts from "typescript";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation } from "../../types.ts";

const POLICY = "boundary-signature-mirrors";
const UTILITY_TYPES = new Set(["Parameters", "ReturnType", "ConstructorParameters"]);
const IGNORED_SEGMENTS = new Set([
  "__fixtures__",
  "__generated__",
  "__mocks__",
  "__tests__",
  "fixtures",
  "generated",
  "node_modules",
  "tests",
]);
const APPLICATION_ROLES = new Set(["api", "worker", "tasks", "server"]);

function isTypeScriptSource(file: string, root: string): boolean {
  const hasTypeScriptExtension = /\.tsx?$/.test(file);
  const isDeclaration = file.endsWith(".d.ts");

  if (!hasTypeScriptExtension || isDeclaration) return false;

  const parts = relative(root, file).split(sep);
  const hasIgnoredSegment = parts.some((part) => IGNORED_SEGMENTS.has(part));
  const isTestFile = /\.(?:test|spec)\.[cm]?tsx?$/.test(file);

  if (hasIgnoredSegment) return false;

  return !isTestFile;
}

function isBoundarySource(file: string, root: string): boolean {
  if (!isTypeScriptSource(file, root)) return false;

  const parts = relative(root, file).split(sep);
  const isCoreFeature = parts[0] === "modules";
  const isEnterpriseFeature = parts.slice(0, 2).join("/") === "enterprise/modules";
  const featureOffset = isEnterpriseFeature ? 1 : 0;
  const isFeature = isCoreFeature || isEnterpriseFeature;
  const isContract =
    isFeature && parts[2 + featureOffset] === "contract" && parts[3 + featureOffset] === "src";
  const isServerApp =
    isFeature && parts[2 + featureOffset] === "server" && parts[4 + featureOffset] === "app";
  const isApplicationComposition = isApplicationCompositionPath(parts, file);

  return isContract || isServerApp || isApplicationComposition;
}

function isApplicationCompositionPath(parts: readonly string[], file: string): boolean {
  const isApplication = parts[0] === "apps";
  const hasApplicationRole = APPLICATION_ROLES.has(parts[1] ?? "");
  const isSource = parts[2] === "src";
  const isComposition = file.endsWith(".composition.ts");

  if (!isApplication || !hasApplicationRole || !isSource) return false;

  return isComposition;
}

function parsed(file: string): ts.SourceFile {
  return sourceFile({ file });
}

type Scope = Set<string>;

function scopeDeclarations(source: ts.SourceFile): WeakMap<ts.Node, Scope> {
  const declarations = new WeakMap<ts.Node, Scope>();
  const ensureScope = (node: ts.Node): Scope => {
    const existing = declarations.get(node);
    if (existing) return existing;

    const scope = new Set<string>();
    declarations.set(node, scope);

    return scope;
  };
  const addName = (scope: Scope, name: ts.BindingName | ts.Identifier | undefined): void => {
    if (name && ts.isIdentifier(name)) scope.add(name.text);
  };
  const hasTypeParameters = (node: ts.Node): boolean =>
    (node as { typeParameters?: readonly ts.TypeParameterDeclaration[] }).typeParameters !==
    undefined;
  const isScope = (node: ts.Node): boolean => {
    const isStructuralScope = ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isBlock(node);
    const isGenericDeclaration =
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node);

    return isStructuralScope || isGenericDeclaration || hasTypeParameters(node);
  };
  const typeParameters = (node: ts.Node): readonly ts.TypeParameterDeclaration[] =>
    (node as { typeParameters?: readonly ts.TypeParameterDeclaration[] }).typeParameters ?? [];
  const visit = (node: ts.Node, parentScope: Scope): void => {
    const ownScope = isScope(node) ? ensureScope(node) : parentScope;

    registerTypeBinding(node, parentScope, addName);

    for (const parameter of typeParameters(node)) addName(ownScope, parameter.name);

    ts.forEachChild(node, (child) => visit(child, ownScope));
  };

  const rootScope = ensureScope(source);
  ts.forEachChild(source, (child) => visit(child, rootScope));

  return declarations;
}

function registerTypeBinding(
  node: ts.Node,
  parentScope: Scope,
  addName: (scope: Scope, name: ts.BindingName | ts.Identifier | undefined) => void,
): void {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return;

    addName(parentScope, clause.name);

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) addName(parentScope, element.name);
    }

    return;
  }

  const typeDeclarationKinds = new Set([
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.EnumDeclaration,
  ]);

  if (!typeDeclarationKinds.has(node.kind)) return;

  const namedNode = node as ts.DeclarationStatement & { name?: ts.Identifier };
  addName(parentScope, namedNode.name);
}

function unwrapParentheses(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;

  return current;
}

function unwrapParenthesesType(node: ts.TypeNode): ts.TypeNode {
  let current = node;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;

  return current;
}

function assertionUsesUnknownOrAny(node: ts.AsExpression | ts.TypeAssertion): boolean {
  const type = unwrapParenthesesType(node.type).kind;

  return type === ts.SyntaxKind.AnyKeyword || type === ts.SyntaxKind.UnknownKeyword;
}

function isNestedBroadAssertion(node: ts.Node): boolean {
  const isAssertion = ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);

  if (!isAssertion) return false;

  const inner = unwrapParentheses(node.expression);
  const isInnerAssertion = ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner);

  return isInnerAssertion && assertionUsesUnknownOrAny(inner);
}

function utilityTypeName(node: ts.TypeReferenceNode): string | undefined {
  if (!ts.isIdentifier(node.typeName)) return undefined;

  const name = node.typeName.text;

  return UTILITY_TYPES.has(name) ? name : undefined;
}

function boundaryViolations(file: string): ArchitectureViolation[] {
  const source = parsed(file);
  const scopes = scopeDeclarations(source);
  const violations: ArchitectureViolation[] = [];
  const report = (node: ts.Node, message: string): void => {
    violations.push({
      policy: POLICY,
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message,
      allowed:
        "Use an explicit named contract input/output and complete ModuleApi, with schemas validating unknown values at the boundary.",
    });
  };

  const reportTypeMirror = (node: ts.TypeReferenceNode): void => {
    const name = utilityTypeName(node);

    if (name === undefined) return;

    report(
      node,
      `Boundary signatures cannot mirror another type with global ${name}; use an explicit named contract input/output and complete ModuleApi.`,
    );
  };

  const visitTypeReference = (node: ts.TypeReferenceNode, activeScopes: readonly Scope[]): void => {
    const name = utilityTypeName(node);

    if (name === undefined) return;

    const shadowed = activeScopes.some((scope) => scope.has(name));

    if (!shadowed) reportTypeMirror(node);
  };

  const visit = (node: ts.Node, activeScopes: readonly Scope[]): void => {
    if (ts.isTypeReferenceNode(node)) visitTypeReference(node, activeScopes);

    if (isNestedBroadAssertion(node)) {
      report(
        node,
        "Boundary assertions cannot hide a nested unknown or any cast; parse and validate unknown with a schema or fix the typed collaborator.",
      );
    }

    const scope = scopes.get(node);
    const nextScopes = scope === undefined ? activeScopes : [...activeScopes, scope];

    ts.forEachChild(node, (child) => visit(child, nextScopes));
  };

  visit(source, []);

  return violations;
}

export function lintBoundarySignatureMirrors(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const files = [join(root, "modules"), join(root, "enterprise"), join(root, "apps")]
    .flatMap((directory) =>
      snapshot.files({ directory, accept: (file) => isBoundarySource(file, root) }),
    )
    .sort();

  return files
    .flatMap(boundaryViolations)
    .sort((left, right) =>
      `${left.file}:${left.line ?? 0}:${left.message}`.localeCompare(
        `${right.file}:${right.line ?? 0}:${right.message}`,
      ),
    );
}
