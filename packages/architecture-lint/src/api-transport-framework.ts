/**
 * `api-transport-through-framework`: a feature's doors are DEFINED through
 * `@langwatch/api`, never hand-rolled beside it.
 *
 * A `transport/api-rest/*.api.ts` file may not reach for the HTTP framework
 * underneath — `hono-openapi`'s `describeRoute` / `validator` / `resolver`,
 * `@hono/zod-validator`, or a `new Hono()` of its own — because a family that
 * mounts its own routes is outside the versioning, the capability declarations,
 * the error envelope and the published document the chain owns.
 *
 * A `transport/api-trpc/*.api.ts` file may not call `initTRPC`, a bare
 * `router({ … })` or `.input(` outside the chain, for the same reason plus one
 * more: the policy has to be applied AFTER the parser, and a hand-written
 * router is where that silently goes wrong.
 *
 * Either kind may not name the legacy RBAC vocabulary. Access is declared in
 * AuthZ terms through the chain; a role enum in a transport file is a second,
 * unreviewable gate.
 *
 * Not-yet-converted files sit in `api-transport-framework-allowlist.json`,
 * which only shrinks: an entry naming a file that no longer offends is itself
 * a violation, so a conversion that leaves its line behind fails.
 *
 * Spec: packages/architecture-lint/specs/api-transport-through-framework.feature.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

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

    if (surface === "rest" && ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (RAW_APP_CONSTRUCTORS.has(node.expression.text)) {
        report({
          line: lineOf(node),
          message: `REST transport constructs ${node.expression.text} of its own.`,
          allowed:
            "Build the family with createRestService; mounting the Hono app is the process's job.",
        });
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
