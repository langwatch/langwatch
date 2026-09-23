import { join, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * `workspace-seams`: the enforcer lints itself. One reading of the workspace is
 * built per run (ADR-099), so a policy that walks, parses or resolves for itself
 * re-reads a tree another policy has read, and does it from a cold cache.
 */

const POLICY = "workspace-seams";

const ENFORCER_PACKAGE = "@langwatch/architecture-enforcer";

/**
 * What a policy may not reach for, and the seam that answers the same question
 * from the reading the run already made.
 */
const SEAMS = new Map<string, { instead: string; because: string }>([
  [
    "createSourceFile",
    {
      instead: "sourceFile({ file })",
      because: "the shared parse cache, so one file is one syntax tree per run",
    },
  ],
  [
    "walkFiles",
    {
      instead: "snapshot.files({ ... }) or listFiles({ ... })",
      because: "the memoised listing, so one directory is one walk per run",
    },
  ],
  [
    "createWorkspaceModuleResolver",
    {
      instead: "snapshot.resolver or workspaceModuleResolver({ root })",
      because: "the one resolver for the root, whose resolution cache is already warm",
    },
  ],
]);

function violation(
  file: string,
  line: number,
  name: string,
  seam: { instead: string; because: string },
): ArchitectureViolation {
  return {
    policy: POLICY,
    file,
    line,
    message: `An architecture policy may not call ${name} directly.`,
    allowed: `Read the workspace through ${seam.instead}: ${seam.because}.`,
  };
}

/** The namespaces a file binds to the TypeScript compiler API, however it imports it. */
function compilerNamespaces(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();

  for (const statement of source.statements) {
    const isCompilerImport =
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "typescript";

    if (!isCompilerImport) continue;

    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;

    if (clause.name) names.add(clause.name.text);

    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
  }

  return names;
}

/**
 * A forbidden name this file imports, reported where it is bound rather than
 * where it is called: an alias is still the same reach for the same function.
 */
function importedSeamViolations(source: ts.SourceFile, file: string): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      const seam = SEAMS.get(imported);
      if (!seam) continue;

      const line = source.getLineAndCharacterOfPosition(element.getStart(source)).line + 1;
      violations.push(violation(file, line, imported, seam));
    }
  }

  return violations;
}

/** A `ts.createSourceFile(...)` call, through whatever name the file binds the compiler to. */
function namespacedParseViolations(source: ts.SourceFile, file: string): ArchitectureViolation[] {
  const namespaces = compilerNamespaces(source);
  if (namespaces.size === 0) return [];

  const violations: ArchitectureViolation[] = [];

  const visit = (node: ts.Node): void => {
    const onCompilerNamespace =
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text);

    if (onCompilerNamespace && ts.isPropertyAccessExpression(node)) {
      const seam = SEAMS.get(node.name.text);

      if (seam) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        violations.push(violation(file, line, node.name.text, seam));
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);

  return violations;
}

/** Every policy source the enforcer ships, which is the whole scope of this rule. */
function policySources(snapshot: WorkspaceSnapshot): readonly string[] {
  const enforcer = snapshot.packages.find((pkg) => pkg.name === ENFORCER_PACKAGE);
  if (!enforcer) return [];

  return snapshot.files({
    directory: join(enforcer.root, "src", "policies"),
    accept: (path) => path.endsWith(".ts") && !path.includes(`${sep}__tests__${sep}`),
  });
}

export function lintWorkspaceSeams(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return policySources(snapshot).flatMap((file) => {
    const source = sourceFile({ file });

    return [...importedSeamViolations(source, file), ...namespacedParseViolations(source, file)];
  });
}
