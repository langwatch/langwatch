/**
 * `api-transport-through-framework`: a feature's doors are DEFINED through
 * `@langwatch/api`, never hand-rolled beside it. Spec:
 * packages/architecture-enforcer/specs/api-transport-through-framework.feature.
 */

// A `transport/api-rest/*.api.ts` file may not reach for the HTTP framework
// underneath — hono-openapi's `describeRoute` / `validator` / `resolver`,
// `@hono/zod-validator`, a `new Hono()` — because a family that mounts its own
// routes is outside the versioning, the capabilities, the error envelope and
// the published document the chain owns.

// A `transport/api-trpc/*.api.ts` file may not call `initTRPC`, a bare
// `router({ … })` or `.input(` outside the chain, for the same reason plus
// one more: the policy has to be applied AFTER the parser, and a hand-written
// router is where that silently goes wrong.

// Either kind may not name the legacy RBAC vocabulary: access is declared in
// AuthZ terms through the chain, and a role enum in a transport file is a
// second, unreviewable gate.

/**
 * Two files folded into one concept: the handler-boundary policy (routes
 * dispatch through the framework, not a raw path) and the through-framework
 * policy above, each with its own id and `lint*` entry in policies/index.ts.
 */

import { existsSync } from "node:fs";
import { join, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, ClassifiedPackage } from "../types.ts";
import { listFiles } from "../workspace/layout.ts";
import { sourceFile } from "../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";

const POLICY = "api-transport-through-framework";

const HONO_OPENAPI_DOOR = new Set(["describeRoute", "validator", "resolver"]);
const RAW_APP_CONSTRUCTORS = new Set(["Hono", "OpenAPIHono"]);
const LEGACY_RBAC_IDENTIFIERS = new Set([
  "TeamRoleGroup",
  "OrganizationUserRole",
  "checkUserPermission",
  "checkUserPermissionForProject",
  "checkUserPermissionForTeam",
  "checkUserPermissionForOrganization",
  "hasTeamPermission",
  "hasOrganizationPermission",
]);

type Surface = "rest" | "trpc";

type Finding = { file: string; line: number; message: string; allowed: string };

const ALLOWED_HANDLER_FIELDS = new Set(["input", "app", "actor", "scope", "signal"]);
const RAW_CONTEXT_FIELDS = new Set([
  "ctx",
  "context",
  "req",
  "request",
  "session",
  "headers",
  "res",
  "response",
]);

function isOutputBypass(
  node: ts.CallExpression,
  enabled: boolean,
): node is ts.CallExpression & { expression: ts.PropertyAccessExpression } {
  return (
    enabled &&
    ts.isPropertyAccessExpression(node.expression) &&
    (node.expression.name.text === "withoutOutput" ||
      node.expression.name.text === "validateOutput")
  );
}

function isRawAppConstruction(
  node: ts.Node,
  rawAppNames: ReadonlySet<string>,
): node is ts.NewExpression & { expression: ts.Identifier } {
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    rawAppNames.has(node.expression.text)
  );
}

function dynamicCompositionImports(source: ts.SourceFile): ts.CallExpression[] {
  const imports: ts.CallExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length === 1) {
          const firstArgument = node.arguments[0];

          if (firstArgument !== undefined) {
            if (ts.isStringLiteral(firstArgument)) {
              if (firstArgument.text === "@langwatch/api/composition") {
                imports.push(node);
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);

  return imports;
}

function isApiModuleSpecifier(specifier: string): boolean {
  return specifier === "@langwatch/api" || specifier.startsWith("@langwatch/api/");
}

type FeatureBindingAnalysis = {
  readonly bindingNames: Set<string>;
  readonly apiBuilderNames: Set<string>;
  readonly apiNamespaceNames: Set<string>;
  readonly rawAppNames: Set<string>;
  readonly rawTrpcNames: Set<string>;
};

function featureBindingAnalysis(
  source: ts.SourceFile,
  report: (node: ts.Node, message: string, allowed: string) => void,
): FeatureBindingAnalysis {
  const bindingNames = new Set<string>();
  const apiBuilderNames = new Set<string>();
  const apiNamespaceNames = new Set<string>();
  const rawAppNames = new Set<string>();
  const rawTrpcNames = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) {
      if (!ts.isExportDeclaration(statement)) continue;
    }

    const moduleSpecifier = statement.moduleSpecifier;
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;

    const specifier = moduleSpecifier.text;

    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;

    if (specifier === "@langwatch/api/composition") {
      report(
        statement,
        `Feature server imports the process-only composition module "${specifier}" (ADR-133).`,
        "Keep @langwatch/api/composition imports in process/framework roots; feature transports use the standard API declaration helpers required by ADR-133.",
      );
    }

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (imported === "createTrpcHandlerBinding") bindingNames.add(element.name.text);

        if (
          [
            "createRestService",
            "createTrpcService",
            "createRestRouter",
            "createTrpcRouter",
          ].includes(imported)
        ) {
          apiBuilderNames.add(element.name.text);
        }

        if (specifier === "hono" && RAW_APP_CONSTRUCTORS.has(imported)) {
          rawAppNames.add(element.name.text);
        }

        if (specifier === "@trpc/server" && imported === "initTRPC") {
          rawTrpcNames.add(element.name.text);
        }
      }
    }

    if (bindings) {
      if (ts.isNamespaceImport(bindings)) {
        if (isApiModuleSpecifier(specifier)) {
          apiNamespaceNames.add(bindings.name.text);
          bindingNames.add(`${bindings.name.text}.createTrpcHandlerBinding`);

          for (const builder of [
            "createRestService",
            "createTrpcService",
            "createRestRouter",
            "createTrpcRouter",
          ]) {
            apiBuilderNames.add(`${bindings.name.text}.${builder}`);
          }
        }
      }
    }
  }

  return { bindingNames, apiBuilderNames, apiNamespaceNames, rawAppNames, rawTrpcNames };
}

function isProductionTransportSource(file: string): boolean {
  return (
    /\.(?:api|rest|trpc)\.ts$/.test(file) &&
    !file.includes(`${sep}__tests__${sep}`) &&
    !/\.(?:test|spec)\.ts$/.test(file)
  );
}

/** Every nested or direct transport declaration under a strict feature package. */
function transportFiles(
  packages: readonly ClassifiedPackage[],
): { file: string; surface: Surface }[] {
  const found: { file: string; surface: Surface }[] = [];

  for (const pkg of packages) {
    if (pkg.kind !== "process") continue;

    for (const surface of ["rest", "trpc"] as const) {
      const root = join(pkg.root, "src", "transport", `api-${surface}`);
      if (!existsSync(root)) continue;

      for (const file of listFiles({ directory: root, accept: isProductionTransportSource }))
        found.push({ file, surface });
    }

    const root = join(pkg.root, "src", "transport");

    for (const surface of ["rest", "trpc"] as const) {
      const direct = join(root, `${pkg.feature}.${surface}.ts`);
      if (existsSync(direct)) found.push({ file: direct, surface });
    }
  }

  return found.toSorted((left, right) => left.file.localeCompare(right.file));
}

function featureServerFiles(packages: readonly ClassifiedPackage[]): string[] {
  return packages.flatMap((pkg) => {
    if (pkg.kind !== "process") return [];

    return listFiles({
      directory: join(pkg.root, "src"),
      accept: (file) => {
        const production = file.endsWith(".ts") || file.endsWith(".tsx");
        const test = file.includes(`${sep}__tests__${sep}`) || /\.(?:test|spec)\.tsx?$/.test(file);

        return production && !test;
      },
    });
  });
}

export function featureServerTransportFindings(source: ts.SourceFile): Finding[] {
  const file = source.fileName;
  const findings: Finding[] = [];

  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const report = (node: ts.Node, message: string, allowed: string): void => {
    findings.push({ file, line: lineOf(node), message, allowed });
  };

  const isTransport = file.includes(`${sep}transport${sep}api-`);

  const { bindingNames, apiBuilderNames, apiNamespaceNames, rawAppNames, rawTrpcNames } =
    featureBindingAnalysis(source, report);

  const hasApiImport = source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isApiModuleSpecifier(statement.moduleSpecifier.text),
  );

  const isApiTransport =
    isTransport || apiBuilderNames.size > 0 || apiNamespaceNames.size > 0 || hasApiImport;

  const dynamicCompositionImport = dynamicCompositionImports(source);

  for (const node of dynamicCompositionImport) {
    report(
      node,
      'Feature server dynamically imports the process-only composition module "@langwatch/api/composition" (ADR-133).',
      "Keep @langwatch/api/composition imports in process/framework roots; feature transports use the standard API declaration helpers required by ADR-133.",
    );
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;

      const calleeText = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? `${callee.expression.getText(source)}.${callee.name.text}`
          : "";

      if (bindingNames.has(calleeText)) {
        report(
          node,
          "Feature server calls createTrpcHandlerBinding (ADR-133).",
          "Create the process/framework handler binding in the application composition root; feature transports expose router declarations.",
        );
      } else if (calleeText.endsWith(".createTrpcHandlerBinding")) {
        report(
          node,
          "Feature server calls createTrpcHandlerBinding (ADR-133).",
          "Create the process/framework handler binding in the application composition root; feature transports expose router declarations.",
        );
      }

      if (ts.isIdentifier(callee)) {
        if (rawTrpcNames.has(callee.text)) {
          report(
            node,
            "Feature server calls initTRPC outside the process/framework root (ADR-133).",
            "Create the tRPC root in the process/framework composition root and provide the configured procedures to the feature transport.",
          );
        }
      }

      if (ts.isPropertyAccessExpression(callee)) {
        if (callee.name.text === "context") {
          if (ts.isIdentifier(callee.expression)) {
            if (rawTrpcNames.has(callee.expression.text)) {
              report(
                node,
                "Feature server calls initTRPC.context() outside the process/framework root (ADR-133).",
                "Create the tRPC root in the process/framework composition root and provide the configured procedures to the feature transport.",
              );
            }
          }
        }
      }

      if (isOutputBypass(node, isApiTransport)) {
        report(
          node,
          `Feature transport bypasses output validation with .${node.expression.name.text}() (ADR-133).`,
          "Declare the mandatory output schema and keep runtime validation enabled through @langwatch/api.",
        );
      }

      if (
        isApiTransport &&
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "handle"
      ) {
        inspectHandler(node, report, source);
      }
    }

    if (isRawAppConstruction(node, rawAppNames)) {
      report(
        node,
        `Feature server constructs ${node.expression.text} outside the process/framework root (ADR-133).`,
        "Construct the process HTTP application in the composition root; feature servers expose transport declarations.",
      );
    }

    if (isApiTransport) {
      if (ts.isPropertyAssignment(node)) {
        if (node.name.getText(source) === "validateOutput") {
          if (node.initializer.kind === ts.SyntaxKind.FalseKeyword) {
            report(
              node,
              "Feature transport disables output validation with validateOutput: false (ADR-133).",
              "Declare the mandatory output schema and keep runtime validation enabled through @langwatch/api.",
            );
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);

  return findings.toSorted((left, right) => left.line - right.line);
}

function inspectHandler(
  call: ts.CallExpression,
  report: (node: ts.Node, message: string, allowed: string) => void,
  source: ts.SourceFile,
): void {
  const argument = call.arguments[0];

  const callback =
    argument && ts.isParenthesizedExpression(argument) ? argument.expression : argument;

  const resolved =
    callback && ts.isIdentifier(callback)
      ? source.statements.find(
          (statement) =>
            (ts.isFunctionDeclaration(statement) && statement.name?.text === callback.text) ||
            (ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.some(
                (declaration) =>
                  ts.isIdentifier(declaration.name) &&
                  declaration.name.text === callback.text &&
                  declaration.initializer &&
                  (ts.isArrowFunction(declaration.initializer) ||
                    ts.isFunctionExpression(declaration.initializer)),
              )),
        )
      : callback;

  const resolvedHandler =
    resolved && ts.isVariableStatement(resolved)
      ? resolved.declarationList.declarations.find(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === callback?.getText(source),
        )?.initializer
      : resolved;

  if (!resolvedHandler) return;

  if (ts.isArrowFunction(resolvedHandler)) {
    // handled below
  } else if (ts.isFunctionExpression(resolvedHandler)) {
    // handled below
  } else if (ts.isFunctionDeclaration(resolvedHandler)) {
    // handled below
  } else {
    return;
  }

  const first = resolvedHandler.parameters[0];
  if (!first) return;

  if (ts.isObjectBindingPattern(first.name)) {
    const rawNames = new Set<string>();

    for (const element of first.name.elements) {
      if (element.dotDotDotToken) {
        report(
          first,
          "Handler receives a spread raw context object (ADR-133).",
          "Handlers receive only { input, app, actor, scope, signal } from the API framework.",
        );

        continue;
      }

      const property = element.propertyName ?? element.name;

      if (ts.isIdentifier(property)) {
        if (!ALLOWED_HANDLER_FIELDS.has(property.text)) {
          report(
            first,
            `Handler receives raw context field "${property.text}" (ADR-133).`,
            "Handlers receive only { input, app, actor, scope, signal } from the API framework.",
          );

          if (ts.isIdentifier(element.name)) rawNames.add(element.name.text);
        }
      }
    }

    if (resolvedHandler.body) {
      for (const rawName of rawNames) inspectRawContextBody(resolvedHandler.body, rawName, report);
    }

    return;
  }

  if (!ts.isIdentifier(first.name)) return;

  if (resolvedHandler.body) {
    for (const name of handlerAliases(resolvedHandler.body, first.name.text, report)) {
      inspectRawContextBody(resolvedHandler.body, name, report);
    }
  }
}

function handlerAliases(
  body: ts.ConciseBody,
  root: string,
  report: (node: ts.Node, message: string, allowed: string) => void,
): Set<string> {
  const names = new Set([root]);

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) {
        if (ts.isIdentifier(node.initializer)) {
          if (names.has(node.initializer.text)) {
            if (ts.isIdentifier(node.name)) names.add(node.name.text);

            if (ts.isObjectBindingPattern(node.name)) {
              for (const element of node.name.elements) {
                const property = element.propertyName ?? element.name;

                if (ts.isIdentifier(property)) {
                  if (!ALLOWED_HANDLER_FIELDS.has(property.text)) {
                    if (ts.isIdentifier(element.name)) {
                      report(
                        element,
                        `Handler receives raw context field "${property.text}" (ADR-133).`,
                        "Handlers receive only { input, app, actor, scope, signal } from the API framework.",
                      );

                      names.add(element.name.text);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);

  return names;
}

function inspectRawContextBody(
  body: ts.ConciseBody,
  name: string,
  report: (node: ts.Node, message: string, allowed: string) => void,
): void {
  const visit = (node: ts.Node): void => {
    let property: string | undefined;

    if (ts.isPropertyAccessExpression(node)) {
      property = node.name.text;
    } else if (ts.isElementAccessExpression(node)) {
      if (node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
        property = node.argumentExpression.text;
      }
    }

    let receiver: string | undefined;

    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        receiver = node.expression.text;
      }
    } else if (ts.isElementAccessExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        receiver = node.expression.text;
      }
    }

    if (receiver === name && property && RAW_CONTEXT_FIELDS.has(property)) {
      report(
        node,
        `Handler reaches raw request context through ${name}.${property} (ADR-133).`,
        "Handlers receive only { input, app, actor, scope, signal } from the API framework.",
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
}

function importedBindings(statement: ts.ImportDeclaration): string[] {
  const clause = statement.importClause;
  if (!clause) return [];

  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);

  const bindings = clause.namedBindings;

  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      names.push(element.propertyName?.text ?? element.name.text);
    }
  }

  return names;
}

function importFindings(
  file: string,
  source: ts.SourceFile,
  surface: Surface,
  report: (finding: Omit<Finding, "file">) => void,
): void {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const specifier = statement.moduleSpecifier.text;
    const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
    const names = importedBindings(statement);

    const specifierSegments = specifier.split("/");

    if (specifierSegments.includes("rbac")) {
      report({
        line,
        message: `Transport file imports the legacy RBAC module "${specifier}".`,
        allowed:
          "Declare access through the chain's withPermission in AuthZ terms; a role module in a transport file is a second, unreviewable gate.",
      });
    }

    if (surface === "rest") {
      if (specifier === "hono-openapi" || specifier.startsWith("hono-openapi/")) {
        const doors = names.filter((name) => HONO_OPENAPI_DOOR.has(name));

        if (doors.length > 0) {
          report({
            line,
            message: `REST transport imports ${doors.join(", ")} from "${specifier}".`,
            allowed:
              "Define the family with createRestService and declare the route through the chain; the framework writes the OpenAPI operation and validates the request.",
          });
        }
      }

      if (specifier === "@hono/zod-validator") {
        report({
          line,
          message: 'REST transport imports "@hono/zod-validator".',
          allowed: "Declare the request shape with the chain's withInput.",
        });
      }
    }

    if (surface === "trpc") {
      if (specifier.startsWith("@trpc/server")) {
        if (names.includes("initTRPC")) {
          report({
            line,
            message: "tRPC transport calls initTRPC; a feature must not create a second root.",
            allowed: "Build on the process's root and procedure, which the mount hands over.",
          });
        }
      }
    }
  }
}

function nodeFindings(
  source: ts.SourceFile,
  surface: Surface,
  report: (finding: Omit<Finding, "file">) => void,
): void {
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (LEGACY_RBAC_IDENTIFIERS.has(node.text)) {
        if (!ts.isImportSpecifier(node.parent)) {
          if (!ts.isPropertyAssignment(node.parent)) {
            report({
              line: lineOf(node),
              message: `Transport file names the legacy RBAC identifier ${node.text}.`,
              allowed:
                "Ask AuthZ for the permission the procedure declares; a role enum is not an access declaration.",
            });
          }
        }
      }
    }

    const constructsRawApp =
      surface === "rest" &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      RAW_APP_CONSTRUCTORS.has(node.expression.text);

    if (constructsRawApp) {
      if (ts.isNewExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          report({
            line: lineOf(node),
            message: `REST transport constructs ${node.expression.text} of its own.`,
            allowed:
              "Build the family with createRestService; mounting the Hono app is the process's job.",
          });
        }
      }
    }

    if (surface === "trpc" && ts.isCallExpression(node)) {
      const callee = node.expression;

      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;

      if (name === "router" && node.arguments.length === 1) {
        report({
          line: lineOf(node),
          message: "tRPC transport builds a bare router({ … }).",
          allowed:
            "Register each procedure through createTrpcService, which applies the process policy after the parser and refuses a procedure with no access declaration.",
        });
      }

      if (name === "input") {
        report({
          line: lineOf(node),
          message: "tRPC transport calls .input(...) outside the chain.",
          allowed:
            "Declare the parser with the chain's withInput, so the policy is applied after it rather than before.",
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
}

/** Every finding in one transport file, in source order. */
export function apiTransportFrameworkFindings(source: ts.SourceFile, surface: Surface): Finding[] {
  const file = source.fileName;
  const findings: Finding[] = [];

  const report = (finding: Omit<Finding, "file">): void => {
    findings.push({ file, ...finding });
  };

  importFindings(file, source, surface, report);
  nodeFindings(source, surface, report);

  return findings.toSorted((left, right) => left.line - right.line);
}

/** Every transport declares its endpoints through the framework; nothing is excused. */
export function lintApiTransportFramework(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, packages } = snapshot;

  const violations: ArchitectureViolation[] = [];

  for (const { file, surface } of transportFiles(packages)) {
    for (const finding of apiTransportFrameworkFindings(
      sourceFile({ file, kind: ts.ScriptKind.TS }),
      surface,
    )) {
      violations.push({
        policy: POLICY,
        file: finding.file,
        line: finding.line,
        message: finding.message,
        allowed: finding.allowed,
      });
    }
  }

  for (const file of featureServerFiles(packages)) {
    for (const finding of featureServerTransportFindings(sourceFile({ file }))) {
      violations.push({
        policy: POLICY,
        file: finding.file,
        line: finding.line,
        message: finding.message,
        allowed: finding.allowed,
      });
    }
  }

  return violations;
}
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

  if (file.endsWith(".mjs")) return ts.ScriptKind.JS;

  if (file.endsWith(".cjs")) return ts.ScriptKind.JS;

  return ts.ScriptKind.TS;
}

function transportSources(packages: readonly ClassifiedPackage[]): TransportSource[] {
  const sources = new Map<string, TransportSource>();

  for (const pkg of packages) {
    const strictFeatureApi = pkg.kind === "process";
    const apiApplication = pkg.kind === "application" && pkg.applicationRole === "api";
    if (!strictFeatureApi && !apiApplication) continue;

    // Strict feature packages scan both `src/transport/<surface>/` (new) and `src/api/` (legacy
    // name that four packages still use). API application scans `app-trpc/`, `app-rest/`, and
    // `features/`. Composition seam (*.composition.ts, *.mount.ts, platform/infrastructure/**)
    // scanned by prisma-containment and application-boundaries instead.
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
      for (const file of listFiles({
        directory: sourceRoot,
        accept: apiApplication ? isScannedApiApplicationSource : isProductionSource,
      })) {
        sources.set(file, { file, strictFeatureApi });
      }
    }
  }

  return [...sources.values()].toSorted((left, right) => left.file.localeCompare(right.file));
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
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        references.push({
          node,
          specifier: node.moduleSpecifier.text,
          importedNames: importedNames(node),
        });

        return;
      }
    }

    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          references.push({ node, specifier: node.moduleSpecifier.text, importedNames: [] });

          return;
        }
      }
    }

    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        if (node.moduleReference.expression) {
          if (ts.isStringLiteral(node.moduleReference.expression)) {
            references.push({
              node,
              specifier: node.moduleReference.expression.text,
              importedNames: [node.name.text],
            });

            return;
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const firstArgument = node.arguments[0];

      if (dynamicImport || requireCall) {
        if (firstArgument) {
          if (ts.isStringLiteral(firstArgument)) {
            references.push({ node, specifier: firstArgument.text, importedNames: [] });
          }
        }
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

  if (specifier === "@prisma/client") return "Prisma or a generated database client";

  if (specifier.startsWith("@prisma/")) return "Prisma or a generated database client";

  if (specifier === "@langwatch/prisma-client") return "Prisma or a generated database client";

  if (specifier.startsWith("@langwatch/prisma-client/")) {
    return "Prisma or a generated database client";
  }

  if (basename === "env") return "environment module";

  if (segments.includes("env")) return "environment module";

  if (/(?:^|[.-])env$/.test(basename)) return "environment module";

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
  if (!name) return null;

  if (ts.isIdentifier(name)) return name.text;

  if (ts.isStringLiteral(name)) return name.text;

  return null;
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
        if (ts.isIdentifier(declaration.name)) {
          if (declaration.initializer) {
            if (ts.isArrowFunction(declaration.initializer)) {
              add(declaration.name.text, declaration.initializer);
            } else if (ts.isFunctionExpression(declaration.initializer)) {
              add(declaration.name.text, declaration.initializer);
            }
          }
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
  if (ts.isPropertyAccessExpression(call.expression)) {
    const methodName = call.expression.name.text;

    if (methodName === "handle") {
      return resolveHandler(call.arguments[0], functions);
    }

    if (methodName === "registerRoute") {
      return resolveHandler(call.arguments[3], functions);
    }

    if (methodName === "register") {
      return resolveHandler(call.arguments[2], functions);
    }
  }

  return null;
}

function handlerRegistration(
  call: ts.CallExpression,
): { candidate: ts.Expression; fluent: boolean } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;

  const methodName = call.expression.name.text;

  if (methodName === "handle" && call.arguments[0] && isFluentEndpointHandle(call)) {
    return { candidate: call.arguments[0], fluent: true };
  }

  if (methodName === "registerRoute" && call.arguments[3]) {
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

  while (true) {
    if (!ts.isCallExpression(receiver)) break;

    if (!ts.isPropertyAccessExpression(receiver.expression)) break;

    const methodName = receiver.expression.name.text;
    if (FLUENT_ENDPOINT_METHODS.has(methodName)) return true;

    receiver = receiver.expression.expression;
  }

  let current: ts.Node = call;

  while (current.parent) {
    current = current.parent;

    if (!ts.isArrowFunction(current)) {
      if (!ts.isFunctionExpression(current)) continue;
    }

    const parent = current.parent;

    if (ts.isCallExpression(parent)) {
      if (ts.isPropertyAccessExpression(parent.expression)) {
        const methodName = parent.expression.name.text;

        if (new Set(["delete", "get", "patch", "post", "put", "register"]).has(methodName)) {
          if (parent.arguments.includes(current)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function unwrapHandlerExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }

    break;
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

        if (ts.isIdentifier(key)) {
          if (!allowedContextFields.has(key.text)) {
            report(
              element,
              `Handler receives raw context field "${key.text}" (ADR-133).`,
              "Handlers receive only { input, app, actor, scope, signal }; request authentication and response shaping belong to framework middleware.",
            );
          }
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

      if (ts.isElementAccessExpression(expression)) {
        if (expression.argumentExpression) {
          if (ts.isStringLiteral(expression.argumentExpression)) {
            const parent = propertyPath(expression.expression);

            return Boolean(parent && parent.length === 1 && aliases.has(parent[0]!));
          }
        }
      }

      return false;
    };

    const directContextMemberName = (expression: ts.Expression): string | null => {
      if (ts.isPropertyAccessExpression(expression)) {
        if (pathIsDirectContextMember(expression.expression)) {
          return expression.name.text;
        }
      }

      if (ts.isElementAccessExpression(expression)) {
        if (expression.argumentExpression) {
          if (ts.isStringLiteral(expression.argumentExpression)) {
            if (pathIsDirectContextMember(expression.expression)) {
              return expression.argumentExpression.text;
            }
          }
        }
      }

      return null;
    };

    const inspectContextMemberAccess = (
      node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    ): void => {
      const member = directContextMemberName(node);

      let propertyName: string | null;

      if (ts.isPropertyAccessExpression(node)) {
        propertyName = node.name.text;
      } else if (ts.isStringLiteral(node.argumentExpression)) {
        propertyName = node.argumentExpression.text;
      } else {
        propertyName = null;
      }

      if ((member && rawFields.has(member)) || propertyName === "headers") {
        report(
          node,
          propertyName === "headers"
            ? `Handler accesses transport headers through ${node.getText(source)} (ADR-133).`
            : `Handler reaches raw request context through ${node.getText(source)} (ADR-133).`,
          "Handlers receive parsed domain input only; authentication, request headers and response shaping belong to framework middleware.",
        );
      }
    };

    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        if (node.initializer) {
          if (ts.isIdentifier(node.name)) {
            if (pathStartsAtContext(node.initializer)) aliases.add(node.name.text);
          }
        }
      }

      if (ts.isPropertyAccessExpression(node)) {
        inspectContextMemberAccess(node);
      } else if (ts.isElementAccessExpression(node)) {
        inspectContextMemberAccess(node);
      }

      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression)) {
          const methodName = node.expression.name.text;

          if (transportMethods.has(methodName)) {
            report(
              node,
              `Handler calls transport response method ${methodName}() (ADR-133).`,
              "Return a declared JSON object/array or void; text, SSE and other response shapes require an explicit custom framework integration outside the handler.",
            );
          }
        }
      }

      if (ts.isNewExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          if (node.expression.text === "Response") {
            report(
              node,
              "Handler constructs a raw Response (ADR-133).",
              "Return a declared JSON object/array or void; text, SSE and other response shapes require an explicit custom framework integration outside the handler.",
            );
          }
        }
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (ts.isPropertyAccessExpression(node.left)) {
          if (directContextMemberName(node.left)) {
            report(
              node,
              `Handler mutates transport response state through ${node.left.getText(source)} (ADR-133).`,
              "Declare status and headers on the fluent endpoint or middleware.",
            );
          }
        } else if (ts.isElementAccessExpression(node.left)) {
          if (directContextMemberName(node.left)) {
            report(
              node,
              `Handler mutates transport response state through ${node.left.getText(source)} (ADR-133).`,
              "Declare status and headers on the fluent endpoint or middleware.",
            );
          }
        }
      }

      if (ts.isReturnStatement(node) && node.expression) {
        const expression = node.expression;

        if (ts.isIdentifier(expression)) {
          if (expression.text === "NO_CONTENT") {
            report(
              expression,
              "Handler returns the NO_CONTENT sentinel (ADR-133).",
              "Return void (or await a void service method) for an empty response; NO_CONTENT is not a transport value.",
            );
          }
        } else if (ts.isPropertyAccessExpression(expression)) {
          if (expression.name.text === "NO_CONTENT") {
            report(
              expression,
              "Handler returns the NO_CONTENT sentinel (ADR-133).",
              "Return void (or await a void service method) for an empty response; NO_CONTENT is not a transport value.",
            );
          }
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
        } else if (!ts.isArrowFunction(inline)) {
          if (!ts.isFunctionExpression(inline)) {
            report(
              registration.candidate,
              "Fluent endpoint handler must be an inline function.",
              "Keep the handler next to its endpoint verb, input, output and permission declarations so the complete boundary is reviewable.",
            );
          }
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

  if (ts.isArrowFunction(candidate)) return candidate;

  if (ts.isFunctionExpression(candidate)) return candidate;

  if (ts.isIdentifier(candidate)) return functions.get(candidate.text) ?? null;

  if (ts.isPropertyAccessExpression(candidate)) {
    return functions.get(candidate.name.text) ?? null;
  }

  if (ts.isCallExpression(candidate)) {
    if (ts.isPropertyAccessExpression(candidate.expression)) {
      const methodName = candidate.expression.name.text;

      if (methodName === "bind") {
        if (ts.isPropertyAccessExpression(candidate.expression.expression)) {
          return functions.get(candidate.expression.expression.name.text) ?? null;
        }
      }
    }
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

  if (!ts.isPropertyAccessExpression(node.expression)) return null;

  const methodName = node.expression.name.text;
  if (methodName !== "create") return null;

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

      if (ts.isIdentifier(key)) {
        bind(element.name, [...path, key.text]);
      } else if (ts.isStringLiteral(key)) {
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

      if (ts.isCallExpression(node)) {
        if (isCanonicalServiceCall(node, contextNames, aliases)) {
          serviceCalls.push(node);
          if (nested) nestedServiceCalls.push(node);
        }
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

    if (ts.isBlock(handler.body)) {
      const statementCount = handler.body.statements.length;

      if (statementCount > HANDLER_STATEMENT_LIMIT) {
        violations.push({
          policy: "api-transport-handler-shape",
          file,
          line: source.getLineAndCharacterOfPosition(handler.body.getStart(source)).line + 1,
          message: `Endpoint handler has ${statementCount} top-level statements; the transport ceiling is ${HANDLER_STATEMENT_LIMIT}.`,
          allowed:
            "Keep the handler to authorization, one service call and optional pure response mapping. Declare rate/resource limits through the transport builder or middleware.",
        });
      }
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
    if (!ts.isImportDeclaration(statement)) continue;

    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    if (statement.moduleSpecifier.text !== "hono") continue;

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
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name)) {
        if (node.initializer) {
          if (ts.isNewExpression(node.initializer)) {
            if (ts.isIdentifier(node.initializer.expression)) {
              const constructorName = node.initializer.expression.text;

              if (honoTypes.has(constructorName)) {
                receivers.add(node.name.text);
              }
            }
          }
        }
      }
    }

    if (ts.isParameter(node)) {
      if (ts.isIdentifier(node.name)) {
        const parameterTypeName = typeName(node.type) ?? "";

        if (honoTypes.has(parameterTypeName)) {
          receivers.add(node.name.text);
        }
      }
    }

    ts.forEachChild(node, collect);
  };

  ts.forEachChild(source, collect);

  const violations: ArchitectureViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text;

        if (RAW_HONO_METHODS.has(methodName)) {
          if (ts.isIdentifier(node.expression.expression)) {
            const receiverName = node.expression.expression.text;

            if (receivers.has(receiverName)) {
              violations.push({
                policy: "api-transport-builder",
                file,
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                message: `Strict feature API registers raw Hono route ${methodName}().`,
                allowed:
                  "Define the endpoint with @langwatch/api and leave Hono mounting to application composition.",
              });
            }
          }
        }
      }
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

  if (ts.isElementAccessExpression(node)) {
    if (node.argumentExpression) {
      if (ts.isStringLiteral(node.argumentExpression)) {
        const key = node.argumentExpression.text;

        if (key === "query" || key === "mutate") return key;
      }
    }
  }

  return null;
}

function stringLocatorViolations(file: string, source: ts.SourceFile): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  const inspectMethodDispatch = (node: ts.MethodDeclaration | ts.MethodSignature): void => {
    const methodName = declarationName(node);
    if (methodName !== "query" && methodName !== "mutate") return;

    if (!parameterIsString(node.parameters[0])) return;

    if (!returnsPromise(node.type)) return;

    violations.push({
      policy: "api-transport-service-locator",
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message: `API transport exposes generic ${methodName}(path: string, ...) dispatch.`,
      allowed:
        "Expose semantic service methods or a typed generated transport client; procedure paths must be compiler-checked.",
    });
  };

  const inspectFunctionPropertyDispatch = (
    node: ts.PropertyDeclaration | ts.PropertySignature,
  ): void => {
    const propertyName = declarationName(node);
    if (propertyName !== "query" && propertyName !== "mutate") return;

    if (node.type === void 0) return;

    if (!ts.isFunctionTypeNode(node.type)) return;

    const dispatchType = node.type;
    if (!parameterIsString(dispatchType.parameters[0])) return;

    if (!returnsPromise(dispatchType.type)) return;

    violations.push({
      policy: "api-transport-service-locator",
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message: `API transport exposes generic ${propertyName}(path: string, ...) dispatch.`,
      allowed:
        "Expose semantic service methods or a typed generated transport client; procedure paths must be compiler-checked.",
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node)) {
      inspectMethodDispatch(node);
    } else if (ts.isMethodSignature(node)) {
      inspectMethodDispatch(node);
    } else if (ts.isPropertyDeclaration(node)) {
      inspectFunctionPropertyDispatch(node);
    } else if (ts.isPropertySignature(node)) {
      inspectFunctionPropertyDispatch(node);
    }

    if (ts.isCallExpression(node)) {
      if (stringDispatchMember(node.expression) !== null) {
        const firstArgument = node.arguments[0];

        if (firstArgument) {
          if (ts.isStringLiteral(firstArgument)) {
            if (/[./]/.test(firstArgument.text)) {
              violations.push({
                policy: "api-transport-service-locator",
                file,
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                message: `API transport dispatches through string path ${JSON.stringify(firstArgument.text)}.`,
                allowed:
                  "Call a semantic service method or a typed generated transport procedure directly.",
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);

  return violations;
}

/**
 * Credential facts a request arrives with, as keys on the framework's context bag.
 * A handler reaching for these does the boundary's job by hand: it gets untyped `any` and
 * cannot see the credential CLASS, so it decides auth from whichever half it happened to read.
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
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text;

        if (methodName === "get") {
          if (node.arguments.length === 1) {
            const firstArgument = node.arguments[0];

            if (firstArgument !== void 0) {
              if (ts.isStringLiteral(firstArgument)) {
                if (CREDENTIAL_CONTEXT_KEYS.has(firstArgument.text)) {
                  violations.push({
                    policy: "api-transport-credential-context",
                    file,
                    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                    message: `API transport reads the credential off the request context (${JSON.stringify(
                      firstArgument.text,
                    )}).`,
                    allowed:
                      "Take the caller as typed input: `credentialPrincipalOf(c)` from @langwatch/api/rest answers with the whole resolved credential, including its class. The context bag is the application's, not the handler's input.",
                  });
                }
              }
            }
          }
        }
      }
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

  // Absolute, deliberately: `lintAll` relativises every violation once, at the
  // end, against the same root. Doing it here too resolved an already-relative
  // path against this package's own directory — a path that did not exist.
  return violations;
}

/** Fast structural checks for strict feature APIs and the API process transport surface. */
export function lintApiTransportBoundaries(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const packages = snapshot.packages;

  return transportSources(packages)
    .flatMap((source) => lintSource(source))
    .toSorted((left, right) =>
      `${left.file}:${left.line ?? 0}:${left.policy}`.localeCompare(
        `${right.file}:${right.line ?? 0}:${right.policy}`,
      ),
    );
}
