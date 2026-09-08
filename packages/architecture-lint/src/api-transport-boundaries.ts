import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./workspace/layout.ts";
import { sourceFile } from "./workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "./types.ts";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SERVICE_OR_REPOSITORY = /(?:App|Service|Repository)$/;
const SERVICE_OR_REPOSITORY_FACTORY = /^create[A-Z].*(?:App|Service|Repository)$/;
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
    // The api application's transport is its request-handling surface —
    // `app-trpc/`, `app-rest/`, and the feature transports under `features/`.
    // `*.composition.ts`, `*.mount.ts` and `platform/infrastructure/**` are
    // the composition seam, not transport, so they are scanned by
    // prisma-containment and application-boundaries instead (R3).
    const sourceRoots = strictFeatureApi
      ? [join(pkg.root, "src", "transport"), join(pkg.root, "src", "api")]
      : [
          join(pkg.root, "src", "app-trpc"),
          join(pkg.root, "src", "app-rest"),
          join(pkg.root, "src", "features"),
        ];
    const isScannedApiApplicationSource = (file: string): boolean =>
      isProductionSource(file) && !/\.(?:mount|composition)\.ts$/.test(file);
    for (const sourceRoot of sourceRoots) {
      for (const file of walkFiles(
        sourceRoot,
        apiApplication ? isScannedApiApplicationSource : isProductionSource,
      )) {
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
    return resolveHandler(call.arguments[0], functions);
  }

  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "registerRoute"
  ) {
    return resolveHandler(call.arguments[3], functions);
  }

  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "register") {
    return null;
  }

  return resolveHandler(call.arguments[2], functions);
}

function handlerRegistration(
  call: ts.CallExpression,
): { candidate: ts.Expression; fluent: boolean } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;

  if (call.expression.name.text === "handle" && call.arguments[0] && isFluentEndpointHandle(call)) {
    return { candidate: call.arguments[0], fluent: true };
  }

  if (call.expression.name.text === "registerRoute" && call.arguments[3]) {
    return { candidate: call.arguments[3], fluent: false };
  }

  return null;
}

const FLUENT_ENDPOINT_METHODS = new Set([
  "withAuth",
  "withInput",
  "withOutput",
  "withPermission",
  "withoutPermission",
  "withStatus",
  "withMiddleware",
  "withRateLimit",
  "withoutRateLimit",
  "withResourceLimit",
  "withoutResourceLimit",
]);

function isFluentEndpointHandle(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  let receiver: ts.Expression = call.expression.expression;
  while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
    if (FLUENT_ENDPOINT_METHODS.has(receiver.expression.name.text)) return true;
    receiver = receiver.expression.expression;
  }

  let current: ts.Node = call;
  while (current.parent) {
    current = current.parent;
    if (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) continue;
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      new Set(["delete", "get", "patch", "post", "put", "register"]).has(
        parent.expression.name.text,
      ) &&
      parent.arguments.includes(current)
    ) {
      return true;
    }
  }

  return false;
}

function unwrapHandlerExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function handlerBoundaryViolations(file: string, source: ts.SourceFile): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const functions = localFunctions(source);
  const visited = new Set<ts.FunctionLikeDeclaration>();
  const report = (node: ts.Node, message: string, allowed: string): void => {
    violations.push({
      policy: "api-transport-handler-boundary",
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message,
      allowed,
    });
  };
  const allowedContextFields = new Set(["input", "app", "actor", "scope", "signal"]);
  const rawFields = new Set(["req", "request", "res", "response", "ctx", "context", "headers"]);
  const transportMethods = new Set([
    "json",
    "body",
    "text",
    "html",
    "redirect",
    "status",
    "header",
    "headers",
  ]);

  const inspect = (handler: ts.FunctionLikeDeclaration): void => {
    if (visited.has(handler) || !handler.body) return;
    visited.add(handler);

    const first = handler.parameters[0];
    const contextNames = new Set<string>();
    if (first && ts.isIdentifier(first.name)) contextNames.add(first.name.text);
    if (first && ts.isObjectBindingPattern(first.name)) {
      for (const element of first.name.elements) {
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) && !allowedContextFields.has(key.text)) {
          report(
            element,
            `Handler receives raw context field "${key.text}" (ADR-133).`,
            "Handlers receive only { input, app, actor, scope, signal }; request authentication and response shaping belong to framework middleware.",
          );
        }
      }
    }

    const aliases = new Set<string>(contextNames);
    const pathStartsAtContext = (expression: ts.Expression): boolean => {
      const path = propertyPath(expression);
      return Boolean(path && path.length === 1 && aliases.has(path[0]!));
    };
    const pathIsDirectContextMember = (expression: ts.Expression): boolean => {
      const path = propertyPath(expression);
      if (path && path.length === 1 && aliases.has(path[0]!)) return true;

      if (
        ts.isElementAccessExpression(expression) &&
        expression.argumentExpression &&
        ts.isStringLiteral(expression.argumentExpression)
      ) {
        const parent = propertyPath(expression.expression);
        return Boolean(parent && parent.length === 1 && aliases.has(parent[0]!));
      }

      return false;
    };
    const directContextMemberName = (expression: ts.Expression): string | null => {
      if (
        ts.isPropertyAccessExpression(expression) &&
        pathIsDirectContextMember(expression.expression)
      ) {
        return expression.name.text;
      }
      if (
        ts.isElementAccessExpression(expression) &&
        expression.argumentExpression &&
        ts.isStringLiteral(expression.argumentExpression) &&
        pathIsDirectContextMember(expression.expression)
      ) {
        return expression.argumentExpression.text;
      }
      return null;
    };
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        if (pathStartsAtContext(node.initializer)) aliases.add(node.name.text);
      }

      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const member = directContextMemberName(node);
        const propertyName = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text
            : null;
        if ((member && rawFields.has(member)) || propertyName === "headers") {
          report(
            node,
            propertyName === "headers"
              ? `Handler accesses transport headers through ${node.getText(source)} (ADR-133).`
              : `Handler reaches raw request context through ${node.getText(source)} (ADR-133).`,
            "Handlers receive parsed domain input only; authentication, request headers and response shaping belong to framework middleware.",
          );
        }
      }

      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const member = directContextMemberName(node.expression);
        const methodName = node.expression.name.text;
        if (transportMethods.has(methodName)) {
          report(
            node,
            `Handler calls transport response method ${methodName}() (ADR-133).`,
            "Return a declared JSON object/array or void; text, SSE and other response shapes require an explicit custom framework integration outside the handler.",
          );
        }
      }

      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Response"
      ) {
        report(
          node,
          "Handler constructs a raw Response (ADR-133).",
          "Return a declared JSON object/array or void; text, SSE and other response shapes require an explicit custom framework integration outside the handler.",
        );
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (
          (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) &&
          directContextMemberName(node.left)
        ) {
          report(
            node,
            `Handler mutates transport response state through ${node.left.getText(source)} (ADR-133).`,
            "Declare status and headers on the fluent endpoint or middleware.",
          );
        }
      }

      if (ts.isReturnStatement(node) && node.expression) {
        const expression = node.expression;
        if (
          (ts.isIdentifier(expression) && expression.text === "NO_CONTENT") ||
          (ts.isPropertyAccessExpression(expression) && expression.name.text === "NO_CONTENT")
        ) {
          report(
            expression,
            "Handler returns the NO_CONTENT sentinel (ADR-133).",
            "Return void (or await a void service method) for an empty response; NO_CONTENT is not a transport value.",
          );
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(handler.body);
  };

  const visitRegistration = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const registration = handlerRegistration(node);
      if (registration) {
        const inline = unwrapHandlerExpression(registration.candidate);
        if (!registration.fluent) {
          report(
            registration.candidate,
            "Legacy registerRoute handler bypasses the fluent endpoint boundary.",
            "Declare the endpoint with the fluent API so verb, input, output, permissions and the inline handler form one typed chain.",
          );
        } else if (!ts.isArrowFunction(inline) && !ts.isFunctionExpression(inline)) {
          report(
            registration.candidate,
            "Fluent endpoint handler must be an inline function.",
            "Keep the handler next to its endpoint verb, input, output and permission declarations so the complete boundary is reviewable.",
          );
        }
        const handler = resolveHandler(registration.candidate, functions);
        if (handler) inspect(handler);
      }
    }
    ts.forEachChild(node, visitRegistration);
  };
  ts.forEachChild(source, visitRegistration);
  return violations;
}

function resolveHandler(
  candidate: ts.Expression | undefined,
  functions: ReadonlyMap<string, ts.FunctionLikeDeclaration>,
): ts.FunctionLikeDeclaration | null {
  if (!candidate) return null;
  candidate = unwrapHandlerExpression(candidate);

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
  const isServicePath = (path: string[]): boolean =>
    (path.length >= 3 && contextNames.has(path[0]!) && path[1] === "app") || aliases.has(path[0]!);
  const bind = (name: ts.BindingName, path: string[]): void => {
    if (ts.isIdentifier(name)) {
      if (isServicePath(path)) aliases.add(name.text);

      return;
    }

    if (!ts.isObjectBindingPattern(name)) return;

    for (const element of name.elements) {
      if (element.dotDotDotToken) continue;

      const key = element.propertyName ?? element.name;
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
        bind(element.name, [...path, key.text]);
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const path = propertyPath(node.initializer);
      if (path) bind(node.name, path);
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
  const path = propertyPath(receiver);
  if (path && aliases.has(path[0]!)) return true;

  return Boolean(path && path.length >= 3 && contextNames.has(path[0]!) && path[1] === "app");
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
          "Authorize and validate at the transport, then call one canonical service once. Move orchestration into the owning service; a pure response mapper may wrap its result. See dev/docs/adr/133-composition-spec.md.",
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

/**
 * A procedure dispatcher answers over the wire, so it returns a Promise. A
 * synchronous `query(name: string): string | undefined` is the request's own
 * query-string reader, which names no procedure at all.
 */
function returnsPromise(type: ts.TypeNode | undefined): boolean {
  if (!type) return true;

  return (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "Promise"
  );
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
        parameterIsString(node.parameters[0]) &&
        returnsPromise(node.type)) ||
      (isFunctionProperty &&
        parameterIsString(node.type.parameters[0]) &&
        returnsPromise(node.type.type))
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

/**
 * The credential facts a request arrives with, as keys on the framework's own
 * context bag.
 *
 * A handler that reaches for these is doing the boundary's job by hand: it
 * gets an untyped `any`, it cannot see the credential CLASS (a legacy project
 * key and a service key both arrive with no user id), and it decides
 * authorization from whichever half it happened to read. That is exactly how
 * `/api/coding-agent/pull-request-usage` came to substitute a key's OWNER for
 * the key. The context is the APPLICATION's — the services and the request's
 * own plumbing; who is calling arrives as typed input.
 */
const CREDENTIAL_CONTEXT_KEYS = new Set([
  "apiKeyId",
  "apiKeyUserId",
  "apiKeyOrganizationId",
  "resolvedToken",
  "orgResolvedToken",
]);

/** `<something>.get("<credential key>")` anywhere in a transport source. */
function credentialContextViolations(file: string, source: ts.SourceFile): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "get" &&
      node.arguments.length === 1 &&
      node.arguments[0] !== void 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      CREDENTIAL_CONTEXT_KEYS.has(node.arguments[0].text)
    ) {
      violations.push({
        policy: "api-transport-credential-context",
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        message: `API transport reads the credential off the request context (${JSON.stringify(
          (node.arguments[0] as ts.StringLiteral).text,
        )}).`,
        allowed:
          "Take the caller as typed input: `credentialPrincipalOf(c)` from @langwatch/api/rest answers with the whole resolved credential, including its class. The context bag is the application's, not the handler's input.",
      });
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  return violations;
}

function lintSource(transport: TransportSource): ArchitectureViolation[] {
  const source = sourceFile({ file: transport.file });
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

  violations.push(...credentialContextViolations(transport.file, source));
  violations.push(...handlerConstructionViolations(transport.file, source));
  violations.push(...handlerShapeViolations(transport.file, source));
  violations.push(...handlerBoundaryViolations(transport.file, source));
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
export function lintApiTransportBoundaries(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const packages = snapshot.packages;

  return transportSources(packages)
    .flatMap((source) => lintSource(source))
    .sort((left, right) =>
      `${left.file}:${left.line ?? 0}:${left.policy}`.localeCompare(
        `${right.file}:${right.line ?? 0}:${right.policy}`,
      ),
    );
}
