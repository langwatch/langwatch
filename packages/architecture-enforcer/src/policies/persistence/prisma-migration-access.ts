import { join } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import {
  moduleImports,
  sourceFile,
  sourceText,
  workspaceModuleResolver,
  type WorkspaceModuleResolver,
} from "../../workspace/module-graph.ts";

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

function isModuleSpecifierImport(
  statement: ts.Statement,
  module: string,
): statement is ts.ImportDeclaration {
  return (
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === module
  );
}

function namedImports(source: ts.SourceFile, module: string, imported: string): Set<string> {
  const result = new Set<string>();

  for (const statement of source.statements) {
    if (!isModuleSpecifierImport(statement, module)) continue;

    const bindings = statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === imported) result.add(binding.name.text);
      }
    }
  }

  return result;
}

function isStaticCreateFactoryMethod(member: ts.ClassElement): boolean {
  if (!ts.isMethodDeclaration(member)) return false;

  if (!ts.isIdentifier(member.name) || member.name.text !== "create") return false;

  return !!ts
    .getModifiers(member)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}

function isNewInstanceOfClass(expression: ts.Expression, className: string): boolean {
  return (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === className
  );
}

function migrationClasses(source: ts.SourceFile): Set<string> {
  if (!/\/process\/src\/migrations\/[^/]+\.migration\.ts$/.test(source.fileName)) return new Set();

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

      const factory = statement.members.find(isStaticCreateFactoryMethod);

      const returns =
        factory && ts.isMethodDeclaration(factory)
          ? (factory.body?.statements.filter(ts.isReturnStatement) ?? [])
          : [];

      const constructsInstance =
        returns.length > 0 &&
        returns.every(
          (statement) =>
            !!statement.expression && isNewInstanceOfClass(statement.expression, className),
        );

      return implementsContract && constructsInstance ? [className] : [];
    }),
  );
}

function isNonTypeOnlyModuleImport(
  statement: ts.Statement,
): statement is ts.ImportDeclaration & { moduleSpecifier: ts.StringLiteral } {
  return (
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    !statement.importClause?.isTypeOnly
  );
}

function isMigrationFactoryCreateCall(params: {
  node: ts.Node;
  member: ts.Node;
  call: ts.Node;
  ownerCall: ts.Node;
  migrations: ReadonlySet<string>;
}): boolean {
  const { node, member, call, ownerCall, migrations } = params;

  if (!ts.isPropertyAccessExpression(member)) return false;

  if (member.expression !== node || member.name.text !== "create") return false;

  if (!ts.isCallExpression(call) || call.expression !== member) return false;

  if (!ts.isCallExpression(ownerCall)) return false;

  if (!ownerCall.arguments.includes(call)) return false;

  if (!ts.isPropertyAccessExpression(ownerCall.expression)) return false;

  if (!ts.isIdentifier(ownerCall.expression.expression)) return false;

  return (
    migrations.has(ownerCall.expression.expression.text) &&
    ownerCall.expression.name.text === "create"
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
    if (!isNonTypeOnlyModuleImport(statement)) continue;

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
    const isBindingReference =
      ts.isIdentifier(node) && bindings.has(node.text) && !ts.isImportSpecifier(node.parent);

    if (isBindingReference) {
      const member = node.parent;
      const call = member.parent;
      const ownerCall = call.parent;

      const inMigrationFactory = isMigrationFactoryCreateCall({
        node,
        member,
        call,
        ownerCall,
        migrations,
      });

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

function isScopedTypeReference(
  node: ts.Node,
  scopes: ReadonlySet<string>,
): node is ts.TypeReferenceNode {
  return (
    ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && scopes.has(node.typeName.text)
  );
}

function isStringLiteralTypeElement(
  element: ts.TypeNode,
): element is ts.LiteralTypeNode & { literal: ts.StringLiteral } {
  return ts.isLiteralTypeNode(element) && ts.isStringLiteral(element.literal);
}

function isValidLiteralModelArray(params: {
  argument: ts.Expression | undefined;
  literals: string[];
  models: ReadonlySet<string>;
}): boolean {
  const { argument, literals, models } = params;

  if (!argument || !ts.isArrayLiteralExpression(argument)) return false;

  if (literals.length === 0 || literals.length !== argument.elements.length) return false;

  return new Set(literals).size === literals.length && literals.every((model) => models.has(model));
}

export function lintPrismaMigrationAccess(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  models: ReadonlySet<string>,
): ArchitectureViolation[] {
  const resolver = workspaceModuleResolver({ root });
  const violations: ArchitectureViolation[] = [];
  const isSourceFile = (file: string) => /\.[cm]?tsx?$/.test(file) && !TEST.test(file);

  const callerFiles = [
    ...catalogue.flatMap((feature) =>
      listFiles({ directory: join(root, feature.root), accept: isSourceFile }),
    ),
    ...listFiles({ directory: join(root, "apps"), accept: isSourceFile }),
  ];

  for (const feature of catalogue) {
    const files = listFiles({ directory: join(root, feature.root), accept: isSourceFile });

    const sources = files.flatMap((file) => {
      const text = sourceText({ file });

      return text.includes("scopedPrismaClient") && text.includes(OWNERSHIP)
        ? [sourceFile({ file })]
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
        const isFactoryBindingReference =
          ts.isIdentifier(node) && factories.has(node.text) && !ts.isImportSpecifier(node.parent);

        if (isFactoryBindingReference) {
          if (ts.isCallExpression(node.parent) && node.parent.expression === node)
            calls.push(node.parent);
          else invalidReference = true;
        }

        if (isScopedTypeReference(node, scopes)) {
          const tuple = node.typeArguments?.[0];

          if (tuple && ts.isTupleTypeNode(tuple))
            scopedTypes.push(
              tuple.elements.flatMap((element) =>
                isStringLiteralTypeElement(element) ? [element.literal.text] : [],
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
        /\/process\/src\/repositories\/prisma\/prisma\.[^/]+-migration\.repository\.ts$/.test(
          source.fileName,
        );

      const consumers = callerFiles
        .filter((file) =>
          moduleImports({ file }).some(
            (imported) => resolver.resolve(imported) === source.fileName,
          ),
        )
        .map((file) => sourceFile({ file }));

      const owner = resolver.owningPackage({ file: source.fileName });

      const publicEntry =
        owner &&
        exportedTargets(owner.exports).some(
          (target) =>
            resolver.resolve({ file: owner.manifestPath, specifier: target }) === source.fileName,
        );

      const isMisplacedOrPublic = !validLocation || publicEntry;

      const hasNoCompliantConsumer =
        !consumers.length ||
        consumers.some(
          (consumer) =>
            !consumer.fileName.startsWith(join(root, feature.root, "process/src/migrations/")) ||
            !constructsOnlyMigration(consumer, source.fileName, resolver),
        );

      if (isMisplacedOrPublic || hasNoCompliantConsumer) {
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

        const validLiteralModels = isValidLiteralModelArray({ argument, literals, models });

        const modelsMismatchDeclaredScope =
          !validLiteralModels ||
          !scopedTypes.some(
            (declared) =>
              declared.length === literals.length &&
              declared.every((model, index) => model === literals[index]),
          );

        if (modelsMismatchDeclaredScope) {
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
