import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SERVICE_OR_REPOSITORY = /(?:Service|Repository)$/;
const SERVICE_OR_REPOSITORY_FACTORY = /^create[A-Z].*(?:Service|Repository)$/;
const RAW_HONO_METHODS = new Set([
  "all",
  "delete",
  "get",
  "head",
  "on",
  "options",
  "patch",
  "post",
  "put",
  "route",
]);
const MODERN_API_METHODS = new Set(["delete", "get", "patch", "post", "put", "register"]);
const HANDLER_STATEMENT_LIMIT = 6;

type TransportSource = {
  file: string;
  strictFeatureApi: boolean;
};

type ImportReference = {
  node: ts.Node;
  specifier: string;
  importedNames: readonly string[];
};

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

function transportSources(packages: readonly ClassifiedPackage[]): TransportSource[] {
  const sources = new Map<string, TransportSource>();

  for (const pkg of packages) {
    const strictFeatureApi = pkg.kind === "server" && pkg.layoutVersion === 0;
    const apiApplication = pkg.kind === "application" && pkg.applicationRole === "api";
    if (!strictFeatureApi && !apiApplication) continue;

    // A strict feature package keeps its doors under `src/transport/<surface>/`.
    // `src/api/` is the name that directory used to have, and four packages
    // still publish a family from it, so both roots are scanned: dropping the
    // old one would stop checking them, and dropping the new one stopped
    // checking everything else — which is what happened when the rename landed
    // and this list still said `src/api` alone.
    const sourceRoots = strictFeatureApi
      ? [join(pkg.root, "src", "transport"), join(pkg.root, "src", "api")]
      : [join(pkg.root, "src")];
    for (const sourceRoot of sourceRoots) {
      for (const file of walkFiles(sourceRoot, isProductionSource)) {
        sources.set(file, { file, strictFeatureApi });
      }
    }
  }

  return [...sources.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function importedNames(statement: ts.ImportDeclaration): string[] {
  const names: string[] = [];
  const clause = statement.importClause;
  if (!clause) return names;
  if (clause.name) names.push(clause.name.text);
  if (!clause.namedBindings) return names;
  if (ts.isNamespaceImport(clause.namedBindings)) {
    names.push(clause.namedBindings.name.text);
    return names;
  }
  for (const element of clause.namedBindings.elements) {
    names.push(element.propertyName?.text ?? element.name.text);
  }
  return names;
}

function importReferences(source: ts.SourceFile): ImportReference[] {
  const references: ImportReference[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({
        node,
        specifier: node.moduleSpecifier.text,
        importedNames: importedNames(node),
      });
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      references.push({ node, specifier: node.moduleSpecifier.text, importedNames: [] });
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      references.push({
        node,
        specifier: node.moduleReference.expression.text,
        importedNames: [node.name.text],
      });
      return;
    }
    if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const firstArgument = node.arguments[0];
      if ((dynamicImport || requireCall) && firstArgument && ts.isStringLiteral(firstArgument)) {
        references.push({ node, specifier: firstArgument.text, importedNames: [] });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return references;
}

function forbiddenImportReason(
  reference: ImportReference,
  strictFeatureApi: boolean,
): string | null {
  const specifier = reference.specifier.replaceAll("\\", "/");
  const segments = specifier.split("/").filter(Boolean);
  const basename = segments.at(-1)?.replace(/\.[cm]?[jt]sx?$/, "") ?? "";
  const importsRepository =
    segments.includes("repositories") ||
    /(?:^|[.-])repository$/.test(basename) ||
    reference.importedNames.some((name) => name.endsWith("Repository"));
  if (importsRepository) return "repository";

  if (
    specifier === "@prisma/client" ||
    specifier.startsWith("@prisma/") ||
    specifier === "@langwatch/prisma-client" ||
    specifier.startsWith("@langwatch/prisma-client/")
  ) {
    return "Prisma or a generated database client";
  }

  if (basename === "env" || segments.includes("env") || /(?:^|[.-])env$/.test(basename)) {
    return "environment module";
  }

  const appImplementation =
    specifier.startsWith("~/server/") ||
    specifier.startsWith("~/runtime/") ||
    specifier.includes("/server/app-layer/") ||
    specifier.includes("/runtime/app/") ||
    specifier.includes("platform/app/src/") ||
    (strictFeatureApi &&
      (specifier === "@langwatch/platform-api/runtime" ||
        specifier === "@langwatch/worker/runtime"));
  return appImplementation ? "process or application implementation" : null;
}

function declarationName(node: ts.NamedDeclaration): string | null {
  const name = node.name;
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;
}

function typeName(node: ts.TypeNode | undefined): string | null {
  if (!node || !ts.isTypeReferenceNode(node)) return null;
  const name = node.typeName;
  if (ts.isIdentifier(name)) return name.text;
  return name.right.text;
}

function expressionName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function localFunctions(source: ts.SourceFile): ReadonlyMap<string, ts.FunctionLikeDeclaration> {
  const functions = new Map<string, ts.FunctionLikeDeclaration>();
  const ambiguous = new Set<string>();
  const add = (name: string, declaration: ts.FunctionLikeDeclaration): void => {
    if (functions.has(name)) {
      functions.delete(name);
      ambiguous.add(name);
    } else if (!ambiguous.has(name)) {
      functions.set(name, declaration);
    }
  };

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      add(statement.name.text, statement);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          add(declaration.name.text, declaration.initializer);
        }
      }
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (ts.isMethodDeclaration(member) && member.body) {
          const name = declarationName(member);
          if (name) add(name, member);
        }
      }
    }
  }
  return functions;
}

function handlerForEndpoint(
  call: ts.CallExpression,
  functions: ReadonlyMap<string, ts.FunctionLikeDeclaration>,
): ts.FunctionLikeDeclaration | null {
  if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "handle") {
    const registration = enclosingRestRegistration(call);
    if (!registration) return null;
    return resolveHandler(call.arguments[0], functions);
  }
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "register") {
    return null;
  }
  return resolveHandler(call.arguments[2], functions);
}

function enclosingRestRegistration(call: ts.CallExpression): ts.CallExpression | null {
  let current: ts.Node = call;
  while (current.parent) {
    current = current.parent;
    if (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) continue;
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      MODERN_API_METHODS.has(parent.expression.name.text) &&
      parent.expression.name.text !== "register" &&
      parent.arguments[2] === current
    ) {
      return parent;
    }
    return null;
  }
  return null;
}

function resolveHandler(
  candidate: ts.Expression | undefined,
  functions: ReadonlyMap<string, ts.FunctionLikeDeclaration>,
): ts.FunctionLikeDeclaration | null {
  if (!candidate) return null;
  if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) return candidate;
  if (ts.isIdentifier(candidate)) return functions.get(candidate.text) ?? null;
  if (ts.isPropertyAccessExpression(candidate)) {
    return functions.get(candidate.name.text) ?? null;
  }
  if (
    ts.isCallExpression(candidate) &&
    ts.isPropertyAccessExpression(candidate.expression) &&
    candidate.expression.name.text === "bind" &&
    ts.isPropertyAccessExpression(candidate.expression.expression)
  ) {
    return functions.get(candidate.expression.expression.name.text) ?? null;
  }
  return null;
}

function serviceOrRepositoryConstruction(
  node: ts.Node,
  importedCanonicalNames: ReadonlyMap<string, string>,
): string | null {
  if (ts.isNewExpression(node)) {
    const localName = expressionName(node.expression);
    const canonicalName = localName ? (importedCanonicalNames.get(localName) ?? localName) : null;
    return canonicalName && SERVICE_OR_REPOSITORY.test(canonicalName) ? canonicalName : null;
  }
  if (!ts.isCallExpression(node)) return null;

  if (ts.isIdentifier(node.expression)) {
    const canonicalName = importedCanonicalNames.get(node.expression.text) ?? node.expression.text;
    return SERVICE_OR_REPOSITORY_FACTORY.test(canonicalName) ? canonicalName : null;
  }
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "create") {
    return null;
  }
  const localName = expressionName(node.expression.expression);
  const canonicalName = localName ? (importedCanonicalNames.get(localName) ?? localName) : null;
  return canonicalName && SERVICE_OR_REPOSITORY.test(canonicalName) ? canonicalName : null;
}

function importedCanonicalNames(source: ts.SourceFile): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      names.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
  return names;
}

function handlerConstructionViolations(
  file: string,
  source: ts.SourceFile,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const functions = localFunctions(source);
  const canonicalNames = importedCanonicalNames(source);
  const visitedHandlers = new Set<ts.FunctionLikeDeclaration>();
  const visitHandler = (handler: ts.FunctionLikeDeclaration): void => {
    if (visitedHandlers.has(handler) || !handler.body) return;
    visitedHandlers.add(handler);
    const visit = (node: ts.Node): void => {
      const construction = serviceOrRepositoryConstruction(node, canonicalNames);
      if (construction) {
        violations.push({
          policy: "api-transport-construction",
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          message: `Endpoint handler constructs ${construction}.`,
          allowed:
            "Construct the process-owned service graph at boot and call the composed service through context.app or the transport context.",
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(handler.body);
  };
  const visitRegistration = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const handler = handlerForEndpoint(node, functions);
      if (handler) visitHandler(handler);
    }
    ts.forEachChild(node, visitRegistration);
  };
  ts.forEachChild(source, visitRegistration);
  return violations;
}

function propertyPath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (!ts.isPropertyAccessExpression(node)) return null;
  const parent = propertyPath(node.expression);
  return parent ? [...parent, node.name.text] : null;
}

function serviceAliases(handler: ts.FunctionLikeDeclaration): ReadonlySet<string> {
  const aliases = new Set<string>();
  if (!handler.body) return aliases;
  const contextNames = new Set(
    handler.parameters
      .map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : null))
      .filter((name): name is string => name !== null),
  );
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const path = propertyPath(node.initializer);
      if (path?.length === 3 && contextNames.has(path[0]!) && path[1] === "app") {
        aliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler.body);
  return aliases;
}

function isCanonicalServiceCall(
  node: ts.CallExpression,
  contextNames: ReadonlySet<string>,
  aliases: ReadonlySet<string>,
): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const receiver = node.expression.expression;
  if (ts.isIdentifier(receiver) && aliases.has(receiver.text)) return true;
  const path = propertyPath(receiver);
  return Boolean(path && path.length === 3 && contextNames.has(path[0]!) && path[1] === "app");
}

function isDomainControlFlow(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isTryStatement(node)
  );
}

function handlerShapeViolations(file: string, source: ts.SourceFile): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const functions = localFunctions(source);
  const visitedHandlers = new Set<ts.FunctionLikeDeclaration>();
  const inspect = (handler: ts.FunctionLikeDeclaration): void => {
    if (visitedHandlers.has(handler) || !handler.body) return;
    visitedHandlers.add(handler);
    const contextNames = new Set(
      handler.parameters
        .map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : null))
        .filter((name): name is string => name !== null),
    );
    const aliases = serviceAliases(handler);
    const serviceCalls: ts.CallExpression[] = [];
    const controlFlow: ts.Node[] = [];
    const nestedServiceCalls: ts.CallExpression[] = [];
    const visit = (node: ts.Node, nestedFunction: boolean): void => {
      const entersNestedFunction = node !== handler.body && ts.isFunctionLike(node);
      const nested = nestedFunction || entersNestedFunction;
      if (!nested && isDomainControlFlow(node)) controlFlow.push(node);
      if (ts.isCallExpression(node) && isCanonicalServiceCall(node, contextNames, aliases)) {
        serviceCalls.push(node);
        if (nested) nestedServiceCalls.push(node);
      }
      ts.forEachChild(node, (child) => visit(child, nested));
    };
    visit(handler.body, false);

    if (serviceCalls.length > 1) {
      const second = serviceCalls[1]!;
      violations.push({
        policy: "api-transport-handler-shape",
        file,
        line: source.getLineAndCharacterOfPosition(second.getStart(source)).line + 1,
        message: `Endpoint handler makes ${serviceCalls.length} canonical service calls.`,
        allowed:
          "Authorize and validate at the transport, then call one canonical service once. Move orchestration into the owning service; a pure response mapper may wrap its result.",
      });
    }

    if (nestedServiceCalls.length > 0) {
      const nestedCall = nestedServiceCalls[0]!;
      violations.push({
        policy: "api-transport-handler-shape",
        file,
        line: source.getLineAndCharacterOfPosition(nestedCall.getStart(source)).line + 1,
        message: "Endpoint handler calls a canonical service from a nested callback.",
        allowed:
          "Expose one bulk or orchestration method on the canonical service instead of dispatching service work from transport callbacks.",
      });
    }

    if (controlFlow.length > 0) {
      const branch = controlFlow[0]!;
      violations.push({
        policy: "api-transport-handler-shape",
        file,
        line: source.getLineAndCharacterOfPosition(branch.getStart(source)).line + 1,
        message: "Endpoint handler contains domain control flow.",
        allowed:
          "Keep authn/authz, wire validation, and named rate/resource limits in transport middleware; call one service and extract pure compatibility mapping. Put decisions and orchestration in the service.",
      });
    }

    if (ts.isBlock(handler.body) && handler.body.statements.length > HANDLER_STATEMENT_LIMIT) {
      violations.push({
        policy: "api-transport-handler-shape",
        file,
        line: source.getLineAndCharacterOfPosition(handler.body.getStart(source)).line + 1,
        message: `Endpoint handler has ${handler.body.statements.length} top-level statements; the transport ceiling is ${HANDLER_STATEMENT_LIMIT}.`,
        allowed:
          "Keep the handler to authorization, one service call and optional pure response mapping. Declare rate/resource limits through the transport builder or middleware.",
      });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const handler = handlerForEndpoint(node, functions);
      if (handler) inspect(handler);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return violations;
}

function honoBindings(source: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "hono"
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name) bindings.add(clause.name.text);
    const named = clause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "Hono") {
        bindings.add(element.name.text);
      }
    }
  }
  return bindings;
}

function rawHonoViolations(file: string, source: ts.SourceFile): ArchitectureViolation[] {
  const honoTypes = honoBindings(source);
  if (honoTypes.size === 0) return [];
  const receivers = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isNewExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      honoTypes.has(node.initializer.expression.text)
    ) {
      receivers.add(node.name.text);
    }
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      honoTypes.has(typeName(node.type) ?? "")
    ) {
      receivers.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  ts.forEachChild(source, collect);

  const violations: ArchitectureViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      RAW_HONO_METHODS.has(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression) &&
      receivers.has(node.expression.expression.text)
    ) {
      violations.push({
        policy: "api-transport-builder",
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        message: `Strict feature API registers raw Hono route ${node.expression.name.text}().`,
        allowed:
          "Define the endpoint with @langwatch/api and leave Hono mounting to application composition.",
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return violations;
}

function parameterIsString(parameter: ts.ParameterDeclaration | undefined): boolean {
  return parameter?.type?.kind === ts.SyntaxKind.StringKeyword;
}

function stringDispatchMember(node: ts.Expression): "query" | "mutate" | null {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "query" || node.name.text === "mutate" ? node.name.text : null;
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression) &&
    (node.argumentExpression.text === "query" || node.argumentExpression.text === "mutate")
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function stringLocatorViolations(file: string, source: ts.SourceFile): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const visit = (node: ts.Node): void => {
    const isMethod = ts.isMethodDeclaration(node) || ts.isMethodSignature(node);
    const methodName = isMethod ? declarationName(node) : null;
    const isFunctionProperty =
      (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) &&
      (declarationName(node) === "query" || declarationName(node) === "mutate") &&
      node.type !== void 0 &&
      ts.isFunctionTypeNode(node.type);
    const functionPropertyName = isFunctionProperty ? declarationName(node) : null;
    if (
      (isMethod &&
        (methodName === "query" || methodName === "mutate") &&
        parameterIsString(node.parameters[0])) ||
      (isFunctionProperty && parameterIsString(node.type.parameters[0]))
    ) {
      const dispatchName = methodName ?? functionPropertyName;
      violations.push({
        policy: "api-transport-service-locator",
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        message: `API transport exposes generic ${dispatchName}(path: string, ...) dispatch.`,
        allowed:
          "Expose semantic service methods or a typed generated transport client; procedure paths must be compiler-checked.",
      });
    }
    if (
      ts.isCallExpression(node) &&
      stringDispatchMember(node.expression) !== null &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      /[./]/.test(node.arguments[0].text)
    ) {
      violations.push({
        policy: "api-transport-service-locator",
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        message: `API transport dispatches through string path ${JSON.stringify(node.arguments[0].text)}.`,
        allowed:
          "Call a semantic service method or a typed generated transport procedure directly.",
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return violations;
}

function lintSource(root: string, transport: TransportSource): ArchitectureViolation[] {
  const source = ts.createSourceFile(
    transport.file,
    readFileSync(transport.file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(transport.file),
  );
  const violations: ArchitectureViolation[] = [];

  for (const reference of importReferences(source)) {
    const reason = forbiddenImportReason(reference, transport.strictFeatureApi);
    if (!reason) continue;
    violations.push({
      policy: "api-transport-import-boundary",
      file: transport.file,
      line: source.getLineAndCharacterOfPosition(reference.node.getStart(source)).line + 1,
      specifier: reference.specifier,
      message: `API transport cannot import a ${reason}.`,
      allowed:
        "Depend on portable contracts and call the process-composed service; persistence, environment and application implementation stay behind composition.",
    });
  }

  violations.push(...handlerConstructionViolations(transport.file, source));
  violations.push(...handlerShapeViolations(transport.file, source));
  violations.push(...stringLocatorViolations(transport.file, source));
  if (transport.strictFeatureApi) {
    violations.push(...rawHonoViolations(transport.file, source));
  }

  // Absolute, deliberately. `lintAll` relativises every violation once, at the
  // end, against the same root — so doing it here too relativised twice: the
  // second pass resolved an already-relative path against the lint package's
  // own directory and reported all thirteen findings under
  // `packages/architecture-lint/apps/api/...`, a path that does not exist. The
  // reader could not open the file the rule named.
  return violations;
}

/** Fast structural checks for strict feature APIs and the API process transport surface. */
export function lintApiTransportBoundaries(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  return transportSources(packages)
    .flatMap((source) => lintSource(root, source))
    .sort((left, right) =>
      `${left.file}:${left.line ?? 0}:${left.policy}`.localeCompare(
        `${right.file}:${right.line ?? 0}:${right.policy}`,
      ),
    );
}
