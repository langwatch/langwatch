/**
 * `api-transport-through-framework`: a feature's doors are DEFINED through
 * `@langwatch/api`, never hand-rolled beside it. Spec:
 * packages/architecture-lint/specs/api-transport-through-framework.feature.
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

// Not-yet-converted files sit in the allowlist, which only shrinks: an entry
// naming a file that no longer offends is itself a violation, so a conversion
// that leaves its line behind fails.

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "./types.ts";

const POLICY = "api-transport-through-framework";
const ALLOWLIST_FILE = "api-transport-framework-allowlist.json";

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
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "@langwatch/api/composition"
    ) {
      imports.push(node);
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
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;

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

    if (bindings && ts.isNamespaceImport(bindings) && isApiModuleSpecifier(specifier)) {
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

  return { bindingNames, apiBuilderNames, apiNamespaceNames, rawAppNames, rawTrpcNames };
}

function isProductionSource(file: string): boolean {
  return (
    file.endsWith(".api.ts") &&
    !file.includes(`${sep}__tests__${sep}`) &&
    !/\.(?:test|spec)\.ts$/.test(file)
  );
}

/** Every `*.api.ts` under a strict feature package's two transport surfaces. */
function transportFiles(
  packages: readonly ClassifiedPackage[],
): { file: string; surface: Surface }[] {
  const found: { file: string; surface: Surface }[] = [];
  for (const pkg of packages) {
    if (pkg.kind !== "server") continue;

    for (const surface of ["rest", "trpc"] as const) {
      const root = join(pkg.root, "src", "transport", `api-${surface}`);
      if (!existsSync(root)) continue;

      for (const file of walkFiles(root, isProductionSource)) found.push({ file, surface });
    }
  }

  return found.sort((left, right) => left.file.localeCompare(right.file));
}

function featureServerFiles(packages: readonly ClassifiedPackage[]): string[] {
  return packages.flatMap((pkg) => {
    if (pkg.kind !== "server") return [];

    return walkFiles(join(pkg.root, "src"), (file) => {
      const production = file.endsWith(".ts") || file.endsWith(".tsx");
      const test = file.includes(`${sep}__tests__${sep}`) || /\.(?:test|spec)\.tsx?$/.test(file);

      return production && !test;
    });
  });
}

export function featureServerTransportFindings(file: string, contents: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
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
      if (bindingNames.has(calleeText) || calleeText.endsWith(".createTrpcHandlerBinding")) {
        report(
          node,
          "Feature server calls createTrpcHandlerBinding (ADR-133).",
          "Create the process/framework handler binding in the application composition root; feature transports expose router declarations.",
        );
      }

      if (ts.isIdentifier(callee) && rawTrpcNames.has(callee.text)) {
        report(
          node,
          "Feature server calls initTRPC outside the process/framework root (ADR-133).",
          "Create the tRPC root in the process/framework composition root and provide the configured procedures to the feature transport.",
        );
      }

      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "context" &&
        ts.isIdentifier(callee.expression) &&
        rawTrpcNames.has(callee.expression.text)
      ) {
        report(
          node,
          "Feature server calls initTRPC.context() outside the process/framework root (ADR-133).",
          "Create the tRPC root in the process/framework composition root and provide the configured procedures to the feature transport.",
        );
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

    if (
      isApiTransport &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "validateOutput" &&
      node.initializer.kind === ts.SyntaxKind.FalseKeyword
    ) {
      report(
        node,
        "Feature transport disables output validation with validateOutput: false (ADR-133).",
        "Declare the mandatory output schema and keep runtime validation enabled through @langwatch/api.",
      );
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  return findings.sort((left, right) => left.line - right.line);
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
  if (
    !resolvedHandler ||
    (!ts.isArrowFunction(resolvedHandler) &&
      !ts.isFunctionExpression(resolvedHandler) &&
      !ts.isFunctionDeclaration(resolvedHandler))
  )
    return;

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
      if (ts.isIdentifier(property) && !ALLOWED_HANDLER_FIELDS.has(property.text)) {
        report(
          first,
          `Handler receives raw context field "${property.text}" (ADR-133).`,
          "Handlers receive only { input, app, actor, scope, signal } from the API framework.",
        );
        if (ts.isIdentifier(element.name)) rawNames.add(element.name.text);
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
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      names.has(node.initializer.text)
    ) {
      if (ts.isIdentifier(node.name)) names.add(node.name.text);

      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(property) &&
            !ALLOWED_HANDLER_FIELDS.has(property.text) &&
            ts.isIdentifier(element.name)
          ) {
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
    const property = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) &&
          node.argumentExpression &&
          ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : undefined;
    const receiver =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression)
        ? node.expression.text
        : undefined;
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
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
    const names = importedBindings(statement);

    if (specifier.split("/").includes("rbac")) {
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

    if (surface === "trpc" && specifier.startsWith("@trpc/server") && names.includes("initTRPC")) {
      report({
        line,
        message: "tRPC transport calls initTRPC; a feature must not create a second root.",
        allowed: "Build on the process's root and procedure, which the mount hands over.",
      });
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
    if (
      ts.isIdentifier(node) &&
      LEGACY_RBAC_IDENTIFIERS.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isPropertyAssignment(node.parent)
    ) {
      report({
        line: lineOf(node),
        message: `Transport file names the legacy RBAC identifier ${node.text}.`,
        allowed:
          "Ask AuthZ for the permission the procedure declares; a role enum is not an access declaration.",
      });
    }

    const constructsRawApp =
      surface === "rest" &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      RAW_APP_CONSTRUCTORS.has(node.expression.text);
    if (constructsRawApp && ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      report({
        line: lineOf(node),
        message: `REST transport constructs ${node.expression.text} of its own.`,
        allowed:
          "Build the family with createRestService; mounting the Hono app is the process's job.",
      });
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
export function apiTransportFrameworkFindings(
  file: string,
  contents: string,
  surface: Surface,
): Finding[] {
  const source = ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings: Finding[] = [];
  const report = (finding: Omit<Finding, "file">): void => {
    findings.push({ file, ...finding });
  };
  importFindings(file, source, surface, report);
  nodeFindings(source, surface, report);

  return findings.sort((left, right) => left.line - right.line);
}

type Allowlist = { readonly files: readonly string[] };

function allowlistPath(root: string): string {
  return join(root, "packages/architecture-lint/src", ALLOWLIST_FILE);
}

export function readApiTransportFrameworkAllowlist(path: string): {
  allowlist: Allowlist;
  violations: ArchitectureViolation[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      allowlist: { files: [] },
      violations: [
        {
          policy: POLICY,
          file: path,
          message: `The allowlist must be valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
          allowed: "Repair the file; it is the ratchet's only record of what is not converted yet.",
        },
      ],
    };
  }

  const files = (raw as { files?: unknown }).files;
  if (!Array.isArray(files) || files.some((entry) => typeof entry !== "string")) {
    return {
      allowlist: { files: [] },
      violations: [
        {
          policy: POLICY,
          file: path,
          message: 'The allowlist must be an object with a "files" array of workspace paths.',
          allowed: "Repair the file; it is the ratchet's only record of what is not converted yet.",
        },
      ],
    };
  }

  const violations: ArchitectureViolation[] = [];
  const sorted = [...(files as string[])].sort();
  if (sorted.some((entry, index) => entry !== files[index])) {
    violations.push({
      policy: POLICY,
      file: path,
      message: "The allowlist must be sorted, so two conversions never conflict on the same line.",
      allowed: "Sort the entries.",
    });
  }

  if (new Set(files as string[]).size !== files.length) {
    violations.push({
      policy: POLICY,
      file: path,
      message: "The allowlist names a file twice.",
      allowed: "Remove the duplicate entry.",
    });
  }

  return { allowlist: { files: files as string[] }, violations };
}

/** The ratchet: only a shrinking list of unconverted transport files may offend. */
export function lintApiTransportFramework(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const path = allowlistPath(root);
  const { allowlist, violations } = readApiTransportFrameworkAllowlist(path);
  const allowed = new Set(allowlist.files);
  const offending = new Set<string>();

  for (const { file, surface } of transportFiles(packages)) {
    const findings = apiTransportFrameworkFindings(file, readFileSync(file, "utf8"), surface);
    if (findings.length === 0) continue;

    const workspaceFile = relative(root, file);
    offending.add(workspaceFile);
    if (allowed.has(workspaceFile)) continue;

    for (const finding of findings) {
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
    for (const finding of featureServerTransportFindings(file, readFileSync(file, "utf8"))) {
      violations.push({
        policy: POLICY,
        file: finding.file,
        line: finding.line,
        message: finding.message,
        allowed: finding.allowed,
      });
    }
  }

  // The half that makes the list shrink on its own: a converted file whose
  // entry was left behind reads, to the next author, as a file still waiting
  // to be converted.
  for (const entry of allowlist.files) {
    if (offending.has(entry)) continue;

    violations.push({
      policy: POLICY,
      file: path,
      message: `The allowlist still names ${entry}, which no longer defines its transport outside the framework.`,
      allowed: "Delete the entry. The list only shrinks.",
    });
  }

  return violations;
}
