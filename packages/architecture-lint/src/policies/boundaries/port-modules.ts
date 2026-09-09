import { readFileSync } from "node:fs";
import ts from "typescript";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";
import { walkFiles } from "../../workspace/layout.ts";

function isStrictPort(path: string): boolean {
  return /\/server\/src\/ports\/.+\.port\.ts$/.test(path);
}

function hasOnlyExportedAbstractPortClasses(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    false,
  );
  let hasPort = false;
  for (const statement of source.statements) {
    const isTypeDeclaration =
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement);
    const isValueDeclaration =
      ts.isFunctionDeclaration(statement) || ts.isEnumDeclaration(statement);
    const named = isTypeDeclaration || isValueDeclaration;
    const isPortDeclaration = named && statement.name?.text.endsWith("Port");
    if (!isPortDeclaration) {
      continue;
    }

    const modifiers = statement.modifiers ?? [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }

    hasPort = true;
    const isAbstractPortClass =
      ts.isClassDeclaration(statement) &&
      modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword);
    if (!isAbstractPortClass) {
      return false;
    }
  }

  return hasPort;
}

/**
 * Strict feature ports are nominal abstract classes. The inventory that once
 * excused the type-bag ports reached zero and is gone: the rule is a plain
 * refusal now.
 */
export function lintStrictPortModules(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const packages = snapshot.packages;

  const violations: ArchitectureViolation[] = [];

  for (const pkg of packages) {
    if (pkg.kind !== "server" || pkg.layoutVersion !== 0) continue;

    for (const file of snapshot.files({ directory: pkg.root, accept: isStrictPort })) {
      if (hasOnlyExportedAbstractPortClasses(file)) continue;

      violations.push({
        policy: "strict-port-module",
        file,
        message:
          "A strict feature port module must export an abstract class whose name ends in Port.",
        allowed:
          "Keep portable supporting types, but model the runtime boundary as an abstract Port class.",
      });
    }
  }

  return violations;
}
