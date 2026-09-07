import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files.ts";
import type { ArchitectureViolation, FeatureCatalogueEntry } from "./types.ts";

const OWNERSHIP_MODULE = "@langwatch/prisma-client/ownership";
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;

type Bindings = { named: Set<string>; namespaces: Set<string> };
type Claim = { feature: string; file: string; model: string; line: number };

function issue(file: string, message: string, line?: number): ArchitectureViolation {
  return {
    policy: "prisma-table-ownership",
    file,
    line,
    message,
    allowed:
      "Declare literal model names with static readonly tables = prismaTables(...) on the owning Prisma repository. Peers call the owner's FeatureApi. See ADR-134.",
  };
}

function isClaimProperty(call: ts.CallExpression, file: string): boolean {
  const property = call.parent;
  if (!ts.isPropertyDeclaration(property)) return false;

  if (!ts.isClassDeclaration(property.parent)) return false;

  if (!ts.isIdentifier(property.name)) return false;

  if (property.name.text !== "tables") return false;

  const modifiers = ts.getModifiers(property) ?? [];

  return (
    modifiers.some((item) => item.kind === ts.SyntaxKind.StaticKeyword) &&
    modifiers.some((item) => item.kind === ts.SyntaxKind.ReadonlyKeyword) &&
    /\/server\/src\/repositories\/prisma\/prisma\.[^/]+\.repository\.ts$/.test(file)
  );
}

function importedBindings(source: ts.SourceFile): Bindings {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    if (statement.moduleSpecifier.text !== OWNERSHIP_MODULE) continue;

    const imported = statement.importClause?.namedBindings;
    if (!imported) continue;

    if (ts.isNamespaceImport(imported)) {
      namespaces.add(imported.name.text);
      continue;
    }

    for (const binding of imported.elements) {
      if ((binding.propertyName ?? binding.name).text === "prismaTables") {
        named.add(binding.name.text);
      }
    }
  }

  return { named, namespaces };
}

function isFactoryReference(node: ts.Node, bindings: Bindings): boolean {
  if (ts.isIdentifier(node)) {
    return bindings.named.has(node.text) && !ts.isImportSpecifier(node.parent);
  }

  if (!ts.isPropertyAccessExpression(node)) return false;

  if (!ts.isIdentifier(node.expression)) return false;

  return bindings.namespaces.has(node.expression.text) && node.name.text === "prismaTables";
}

function rejectsNamespaceForward(node: ts.Node, bindings: Bindings): boolean {
  if (!ts.isIdentifier(node)) return false;

  if (!bindings.namespaces.has(node.text)) return false;

  if (ts.isNamespaceImport(node.parent)) return false;

  const parent = node.parent;
  const directProperty = ts.isPropertyAccessExpression(parent) && parent.expression === node;

  return !directProperty || parent.name.text !== "prismaTables";
}

function lintFactoryExports(source: ts.SourceFile): ArchitectureViolation[] {
  return source.statements.filter(ts.isExportDeclaration).flatMap((statement) => {
    const module = statement.moduleSpecifier;
    if (!module || !ts.isStringLiteral(module)) return [];

    if (statement.isTypeOnly || module.text !== OWNERSHIP_MODULE) return [];

    return [
      issue(
        source.fileName,
        "Do not re-export the Prisma ownership module; repositories import prismaTables directly.",
      ),
    ];
  });
}

function claimCalls(
  source: ts.SourceFile,
  violations: ArchitectureViolation[],
): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const bindings = importedBindings(source);
  violations.push(...lintFactoryExports(source));
  const visit = (node: ts.Node): void => {
    if (rejectsNamespaceForward(node, bindings)) {
      violations.push(
        issue(
          source.fileName,
          "Do not forward or use computed access on the Prisma ownership namespace.",
        ),
      );
    }

    if (isFactoryReference(node, bindings)) {
      const parent = node.parent;
      const directCall = ts.isCallExpression(parent) && parent.expression === node;
      if (directCall) {
        calls.push(parent);
      } else {
        violations.push(
          issue(
            source.fileName,
            "Do not alias or forward prismaTables; keep the repository claim directly inspectable.",
          ),
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return calls;
}

function readClaim(
  call: ts.CallExpression,
  source: ts.SourceFile,
  feature: string,
  violations: ArchitectureViolation[],
): Claim[] {
  const file = source.fileName;
  const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;
  if (!isClaimProperty(call, file)) {
    violations.push(
      issue(file, "Prisma table claims belong to a static readonly repository declaration.", line),
    );
  }

  const computed = call.arguments.some((argument) => !ts.isStringLiteral(argument));
  if (call.arguments.length === 0 || computed) {
    violations.push(
      issue(
        file,
        "A Prisma claim needs at least one literal model name; spreads and computed claims hide ownership.",
        line,
      ),
    );

    return [];
  }

  return call.arguments
    .filter(ts.isStringLiteral)
    .map((argument) => ({ feature, file, model: argument.text, line }));
}

function featureClaims(
  root: string,
  feature: FeatureCatalogueEntry,
  violations: ArchitectureViolation[],
): Claim[] {
  const files = walkFiles(
    join(root, feature.root),
    (file) => /\.[cm]?tsx?$/.test(file) && !TEST_FILE.test(file),
  );

  return files.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    if (!text.includes(OWNERSHIP_MODULE)) return [];

    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    return claimCalls(source, violations).flatMap((call) =>
      readClaim(call, source, feature.id, violations),
    );
  });
}

function checkOwners(
  claims: readonly Claim[],
  models: ReadonlyMap<string, string>,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const owners = new Map<string, Claim>();
  for (const claim of claims) {
    const table = models.get(claim.model);
    if (!table) {
      violations.push(issue(claim.file, `Unknown Prisma model ${claim.model}.`, claim.line));
      continue;
    }

    const previous = owners.get(table);
    if (previous && previous.feature !== claim.feature) {
      violations.push(
        issue(
          claim.file,
          `Table ${table} is claimed by ${claim.feature} and ${previous.feature} (${previous.file}). Keep a single feature owner.`,
          claim.line,
        ),
      );
    } else {
      owners.set(table, claim);
    }
  }

  return violations;
}

/** Checks explicit adoption across the catalogue, including features never installed together. */
export function lintPrismaTableOwnership(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
): ArchitectureViolation[] {
  const schemaFile = join(root, "packages/prisma-client/prisma/schema.prisma");
  if (!existsSync(schemaFile)) return [];

  const schema = readFileSync(schemaFile, "utf8");
  const models = new Map<string, string>();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = match[1];
    if (name) models.set(name, /@@map\(\s*"([^"]+)"\s*\)/.exec(match[2] ?? "")?.[1] ?? name);
  }

  const violations: ArchitectureViolation[] = [];
  const claims = catalogue.flatMap((feature) => featureClaims(root, feature, violations));

  return [...violations, ...checkOwners(claims, models)];
}
