import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { walkFiles } from "../../workspace/layout.ts";
import {
  createWorkspaceModuleResolver,
  moduleImports,
  type WorkspaceModuleResolver,
} from "../../workspace/module-graph.ts";
import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";

const OWNERSHIP = "@langwatch/prisma-client/ownership";
const TEST = /(?:__tests__|__fixtures__|\.(?:test|spec)\.)/;

function violation(file: string, message: string): ArchitectureViolation {
  return {
    file,
    policy: "prisma-table-ownership",
    message,
    allowed:
      "Use PrismaRepository.for(...) for feature ownership. Only a private repository constructed by a SystemMigration may use a literal scopedPrismaClient capability. Never export that repository or pass it to an App.",
  };
}

function namedImports(source: ts.SourceFile, module: string, imported: string): Set<string> {
  const result = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== module
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === imported) result.add(binding.name.text);
      }
    }
  }
  return result;
}

function migrationClasses(source: ts.SourceFile): Set<string> {
  if (!/\/server\/src\/migrations\/[^/]+\.migration\.ts$/.test(source.fileName)) return new Set();
  const contracts = namedImports(source, "@langwatch/system-migrations", "SystemMigration");
  return new Set(
    source.statements.flatMap((statement) => {
      if (!ts.isClassDeclaration(statement) || !statement.name) return [];
      const implementsContract = statement.heritageClauses?.some(
        (clause) =>
          clause.token === ts.SyntaxKind.ImplementsKeyword &&
          clause.types.some(
            (type) => ts.isIdentifier(type.expression) && contracts.has(type.expression.text),
          ),
      );
      const className = statement.name.text;
      const factory = statement.members.find(
        (member) =>
          ts.isMethodDeclaration(member) &&
          ts.isIdentifier(member.name) &&
          member.name.text === "create" &&
          ts
            .getModifiers(member)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
      );
      const returns =
        factory && ts.isMethodDeclaration(factory)
          ? (factory.body?.statements.filter(ts.isReturnStatement) ?? [])
          : [];
      const constructsInstance =
        returns.length > 0 &&
        returns.every(
          (statement) =>
            statement.expression &&
            ts.isNewExpression(statement.expression) &&
            ts.isIdentifier(statement.expression.expression) &&
            statement.expression.expression.text === className,
        );
      return implementsContract && constructsInstance ? [className] : [];
    }),
  );
}

function constructsOnlyMigration(
  source: ts.SourceFile,
  repositoryFile: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  const migrations = migrationClasses(source);
  if (!migrations.size) return false;
  const bindings = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    if (
      resolver.resolve({ file: source.fileName, specifier: statement.moduleSpecifier.text }) !==
      repositoryFile
    )
      continue;
    const imported = statement.importClause?.namedBindings;
    if (!imported || !ts.isNamedImports(imported)) return false;
    for (const binding of imported.elements)
      if (!binding.isTypeOnly) bindings.add(binding.name.text);
  }
  let valid = bindings.size > 0;
  let constructionCount = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && bindings.has(node.text) && !ts.isImportSpecifier(node.parent)) {
      const member = node.parent;
      const call = member.parent;
      const ownerCall = call.parent;
      const inMigrationFactory =
        ts.isPropertyAccessExpression(member) &&
        member.expression === node &&
        member.name.text === "create" &&
        ts.isCallExpression(call) &&
        call.expression === member &&
        ts.isCallExpression(ownerCall) &&
        ownerCall.arguments.includes(call) &&
        ts.isPropertyAccessExpression(ownerCall.expression) &&
        ts.isIdentifier(ownerCall.expression.expression) &&
        migrations.has(ownerCall.expression.expression.text) &&
        ownerCall.expression.name.text === "create";
      if (inMigrationFactory) constructionCount += 1;
      else valid = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return valid && constructionCount > 0;
}

function exportedTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(exportedTargets);
}

export function lintPrismaMigrationAccess(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  models: ReadonlySet<string>,
): ArchitectureViolation[] {
  const resolver = createWorkspaceModuleResolver({ root });
  const violations: ArchitectureViolation[] = [];
  const sourceFile = (file: string) => /\.[cm]?tsx?$/.test(file) && !TEST.test(file);
  const callerFiles = [
    ...catalogue.flatMap((feature) => walkFiles(join(root, feature.root), sourceFile)),
    ...walkFiles(join(root, "apps"), sourceFile),
  ];
  for (const feature of catalogue) {
    const files = walkFiles(
      join(root, feature.root),
      (file) => /\.[cm]?tsx?$/.test(file) && !TEST.test(file),
    );
    const sources = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return text.includes("scopedPrismaClient") && text.includes(OWNERSHIP)
        ? [ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]
        : [];
    });
    for (const source of sources) {
      if (!source.text.includes("scopedPrismaClient") || !source.text.includes(OWNERSHIP)) continue;
      const factories = namedImports(source, OWNERSHIP, "scopedPrismaClient");
      const scopes = namedImports(source, OWNERSHIP, "ScopedPrismaClient");
      const scopedTypes: string[][] = [];
      const calls: ts.CallExpression[] = [];
      let invalidReference = false;
      const visit = (node: ts.Node): void => {
        if (
          ts.isIdentifier(node) &&
          factories.has(node.text) &&
          !ts.isImportSpecifier(node.parent)
        ) {
          if (ts.isCallExpression(node.parent) && node.parent.expression === node)
            calls.push(node.parent);
          else invalidReference = true;
        }
        if (
          ts.isTypeReferenceNode(node) &&
          ts.isIdentifier(node.typeName) &&
          scopes.has(node.typeName.text)
        ) {
          const tuple = node.typeArguments?.[0];
          if (tuple && ts.isTupleTypeNode(tuple))
            scopedTypes.push(
              tuple.elements.flatMap((element) =>
                ts.isLiteralTypeNode(element) && ts.isStringLiteral(element.literal)
                  ? [element.literal.text]
                  : [],
              ),
            );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (!calls.length || invalidReference) {
        violations.push(
          violation(
            source.fileName,
            "Do not alias, dynamically access or re-export scopedPrismaClient; call its named import directly inside a private migration repository.",
          ),
        );
        continue;
      }
      const validLocation =
        /\/server\/src\/repositories\/prisma\/prisma\.[^/]+-migration\.repository\.ts$/.test(
          source.fileName,
        );
      const consumers = callerFiles
        .filter((file) =>
          moduleImports({ file }).some(
            (imported) => resolver.resolve(imported) === source.fileName,
          ),
        )
        .map((file) =>
          ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true),
        );
      const owner = resolver.owningPackage({ file: source.fileName });
      const publicEntry =
        owner &&
        exportedTargets(owner.exports).some(
          (target) =>
            resolver.resolve({ file: owner.manifestPath, specifier: target }) === source.fileName,
        );
      if (
        !validLocation ||
        publicEntry ||
        !consumers.length ||
        consumers.some(
          (consumer) =>
            !consumer.fileName.startsWith(join(root, feature.root, "server/src/migrations/")) ||
            !constructsOnlyMigration(consumer, source.fileName, resolver),
        )
      ) {
        violations.push(
          violation(
            source.fileName,
            "A scoped Prisma repository must be private and constructed only by the owning feature's imported SystemMigration implementation; filenames and decoy migration classes do not grant access.",
          ),
        );
      }
      for (const call of calls) {
        const argument = call.arguments[1];
        const literals =
          argument && ts.isArrayLiteralExpression(argument)
            ? argument.elements.flatMap((element) =>
                ts.isStringLiteral(element) ? [element.text] : [],
              )
            : [];
        const validLiteralModels =
          argument &&
          ts.isArrayLiteralExpression(argument) &&
          literals.length > 0 &&
          literals.length === argument.elements.length &&
          new Set(literals).size === literals.length &&
          literals.every((model) => models.has(model));
        if (
          !validLiteralModels ||
          !scopedTypes.some(
            (declared) =>
              declared.length === literals.length &&
              declared.every((model, index) => model === literals[index]),
          )
        ) {
          violations.push(
            violation(
              source.fileName,
              "Migration access needs nonempty literal Prisma models matching its ScopedPrismaClient tuple exactly; computed, duplicate and unknown models are forbidden.",
            ),
          );
        }
      }
    }
  }
  return violations;
}
