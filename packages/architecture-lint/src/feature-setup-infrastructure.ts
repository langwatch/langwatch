import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";
import { sourceFile, type WorkspaceModuleResolver } from "./workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "./types.ts";

function isImportWithLiteral(node: ts.Statement): node is ts.ImportDeclaration {
  return ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier);
}

function namespaceMatches(name: string, namespace: ts.NamespaceImport): boolean {
  return name.startsWith(`${namespace.name.text}.`);
}

function unionOrIntersection(
  type: ts.TypeNode,
): type is ts.UnionTypeNode | ts.IntersectionTypeNode {
  return ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type);
}

function hasSubstitution(
  type: ts.TypeReferenceNode,
  substitutions: ReadonlyMap<string, ts.TypeNode>,
): boolean {
  return ts.isIdentifier(type.typeName) && substitutions.has(type.typeName.text);
}

function substitutionName(type: ts.TypeReferenceNode): string | undefined {
  return ts.isIdentifier(type.typeName) ? type.typeName.text : undefined;
}

function shouldVisit(file: string, key: string, visited: ReadonlySet<string>): boolean {
  return !visited.has(key) && existsSync(file);
}

function substitution(
  type: ts.TypeNode,
  substitutions: ReadonlyMap<string, ts.TypeNode>,
): ts.TypeNode | undefined {
  if (!ts.isTypeReferenceNode(type)) return undefined;

  const name = substitutionName(type);

  return name ? substitutions.get(name) : undefined;
}

function literalString(item: ts.TypeNode): string | undefined {
  if (!ts.isLiteralTypeNode(item)) return undefined;

  const literal = item.literal;
  if (!ts.isStringLiteral(literal)) return undefined;

  return literal.text;
}

function literalStrings(item: ts.TypeNode): string[] {
  if (unionOrIntersection(item)) return item.types.flatMap(literalStrings);

  const value = literalString(item);

  return value ? [value] : [];
}

function namedTypeDeclaration(item: ts.Statement, name: string): boolean {
  if (ts.isInterfaceDeclaration(item)) return item.name.text === name;

  if (ts.isTypeAliasDeclaration(item)) return item.name.text === name;

  if (ts.isClassDeclaration(item)) return item.name?.text === name;

  return false;
}

function source(file: string): ts.SourceFile {
  return sourceFile({ file });
}

function typeName(node: ts.EntityName): string {
  return node.getText();
}

function importedTarget(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): { file: string; name: string } | undefined {
  for (const statement of source(file).statements) {
    if (!isImportWithLiteral(statement)) continue;

    const clause = statement.importClause;
    if (!clause?.namedBindings) continue;

    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) continue;

    const target = resolver.resolve({ file, specifier: moduleSpecifier.text });
    if (!target) continue;

    const namespaceResult = namespaceImportTarget(name, clause.namedBindings, target);
    if (namespaceResult) return namespaceResult;

    if (ts.isNamespaceImport(clause.namedBindings)) continue;

    const element = clause.namedBindings.elements.find((item) => item.name.text === name);
    if (element) return { file: target, name: element.propertyName?.text ?? name };
  }

  return undefined;
}

function namespaceImportTarget(
  name: string,
  bindings: ts.NamedImportBindings,
  target: string,
): { file: string; name: string } | undefined {
  if (!ts.isNamespaceImport(bindings)) return undefined;

  if (!namespaceMatches(name, bindings)) return undefined;

  return { file: target, name: name.slice(bindings.name.text.length + 1) };
}

function declaration(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): { node: ts.Node; file: string } | undefined {
  const key = `${file}:${name}`;
  if (!shouldVisit(file, key, visited)) return undefined;

  visited.add(key);
  const statement = source(file).statements.find((item) => namedTypeDeclaration(item, name));
  if (statement) return { node: statement, file };

  const imported = importedTarget(file, name, resolver);
  if (imported) return declaration(imported.file, imported.name, resolver, visited);

  return reexportedDeclaration(file, name, resolver, visited);
}

function reexportedDeclaration(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): { node: ts.Node; file: string } | undefined {
  for (const exported of source(file).statements) {
    if (!ts.isExportDeclaration(exported)) continue;

    const moduleSpecifier = exported.moduleSpecifier;
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;

    const target = resolver.resolve({ file, specifier: moduleSpecifier.text });
    if (!target) continue;

    const original = exportedName(exported, name);
    const resolved = declaration(target, original, resolver, visited);
    if (resolved) return resolved;
  }

  return undefined;
}

function exportedName(exported: ts.ExportDeclaration, name: string): string {
  if (!exported.exportClause || !ts.isNamedExports(exported.exportClause)) return name;

  const element = exported.exportClause.elements.find((item) => item.name.text === name);

  return element?.propertyName?.text ?? name;
}

function setupInfrastructureType(
  parameter: ts.ParameterDeclaration,
  file: string,
  resolver: WorkspaceModuleResolver,
): ts.TypeNode | undefined {
  const type = parameter.type;

  return type ? setupInfrastructureReference(type, file, resolver) : undefined;
}

function isFeatureSetupImport(file: string, name: string): boolean {
  return source(file).statements.some((statement) => {
    if (!isImportWithLiteral(statement) || !statement.importClause?.namedBindings) {
      return false;
    }

    const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : "";
    if (!moduleName.startsWith("@langwatch/runtime-composition")) return false;

    const bindings = statement.importClause.namedBindings;
    if (ts.isNamespaceImport(bindings)) return false;

    return bindings.elements.some(
      (element) =>
        element.name.text === name &&
        (element.propertyName?.text ?? element.name.text) === "FeatureSetup",
    );
  });
}

function isFeatureSetupTypeName(typeNameNode: ts.EntityName, file: string): boolean {
  if (ts.isIdentifier(typeNameNode)) {
    return isFeatureSetupImport(file, typeNameNode.text);
  }

  const isFeatureSetupMember = typeNameNode.right.text === "FeatureSetup";
  const namespace = ts.isIdentifier(typeNameNode.left) ? typeNameNode.left.text : undefined;
  if (!isFeatureSetupMember || !namespace) {
    return false;
  }

  return source(file).statements.some((statement) => {
    if (!isImportWithLiteral(statement) || !statement.importClause?.namedBindings) {
      return false;
    }

    const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : "";
    if (!moduleName.startsWith("@langwatch/runtime-composition")) {
      return false;
    }

    const bindings = statement.importClause.namedBindings;

    return ts.isNamespaceImport(bindings) && bindings.name.text === namespace;
  });
}

function setupInfrastructureReference(
  type: ts.TypeNode,
  file: string,
  resolver: WorkspaceModuleResolver,
  substitutions = new Map<string, ts.TypeNode>(),
  visited = new Set<string>(),
): ts.TypeNode | undefined {
  if (!ts.isTypeReferenceNode(type)) return undefined;

  if (isFeatureSetupTypeName(type.typeName, file)) {
    const infrastructure = type.typeArguments?.[1];

    return infrastructure ? substituteType(infrastructure, substitutions) : undefined;
  }

  const name = ts.isIdentifier(type.typeName) ? type.typeName.text : typeName(type.typeName);
  const target = declaration(file, name, resolver);
  if (!target || !ts.isTypeAliasDeclaration(target.node)) return undefined;

  const key = `${target.file}:${name}:${type.getText()}`;
  if (visited.has(key)) return undefined;

  visited.add(key);

  const next = new Map(substitutions);
  target.node.typeParameters?.forEach((parameter, index) => {
    const argument = type.typeArguments?.[index];
    if (argument) next.set(parameter.name.text, argument);
  });

  return setupInfrastructureReference(target.node.type, target.file, resolver, next, visited);
}

function substituteType(
  type: ts.TypeNode,
  substitutions: ReadonlyMap<string, ts.TypeNode>,
): ts.TypeNode {
  return substitution(type, substitutions) ?? type;
}

function appFeature(file: string, packages: readonly ClassifiedPackage[]): string | undefined {
  const owner = packages.find((pkg) => file.startsWith(`${pkg.root}${sep}`));

  return owner?.feature;
}

function isSelected(context: PropertyContext, property: string): boolean {
  if (!context.selection) return true;

  const retained = context.selection.keys.has(property);

  return context.selection.name === "Pick" ? retained : !retained;
}

function apiOrService(
  node: ts.TypeReferenceNode,
  file: string,
  resolver: WorkspaceModuleResolver,
  packages: readonly ClassifiedPackage[],
): string | undefined {
  const name = typeName(node.typeName);
  const short = name.split(".").at(-1) ?? name;

  const local = declaration(file, name, resolver);
  const owner = local && resolver.owningPackage({ file: local.file });
  if (!owner || !owner.directory.includes(`${sep}features${sep}`)) return undefined;

  const feature = appFeature(local.file, packages);
  const expected = feature
    ?.split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
  const serviceFile =
    local.file.includes(`${sep}features${sep}`) && /\.service\.[^/]+$/.test(local.file);
  const declaredName = declarationName(local.node, short);
  const canonicalName =
    !expected || declaredName === `${expected}Api` || declaredName === `${expected}Service`;
  const ownServiceClass =
    ts.isClassDeclaration(local.node) && (serviceFile || declaredName.endsWith("Service"));
  const ownCanonicalService = declaredName.endsWith("Service") && canonicalName;
  const featureApi = declaredName.endsWith("Api") && local.file.includes(".api.");
  if (!featureApi && !ownServiceClass && !ownCanonicalService) {
    return undefined;
  }

  return `${declaredName}:${local.file}`;
}

function declarationName(node: ts.Node, fallback: string): string {
  const named = ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node);
  if (named && node.name) return node.name.text;

  return fallback;
}

type Finding = {
  node: ts.TypeReferenceNode;
  file: string;
  name: string;
  property?: string;
};
type PropertyContext = {
  file: string;
  resolver: WorkspaceModuleResolver;
  packages: readonly ClassifiedPackage[];
  substitutions: ReadonlyMap<string, ts.TypeNode>;
  visited: Set<string>;
  property?: string;
  selection?: { name: "Pick" | "Omit"; keys: ReadonlySet<string> };
};

function propertyTypes(type: ts.TypeNode, context: PropertyContext): Finding[] {
  const composite = compositeTypes(type, context);
  if (composite) return composite;

  if (!ts.isTypeReferenceNode(type)) return literalTypes(type, context);

  return referenceTypes(type, context);
}

function compositeTypes(type: ts.TypeNode, context: PropertyContext): Finding[] | undefined {
  if (ts.isParenthesizedTypeNode(type)) return propertyTypes(type.type, context);

  if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return propertyTypes(type.type, context);
  }

  if (unionOrIntersection(type)) {
    return type.types.flatMap((item) => propertyTypes(item, context));
  }

  if (ts.isFunctionTypeNode(type)) return propertyTypes(type.type, context);

  if (ts.isArrayTypeNode(type)) return propertyTypes(type.elementType, context);

  return undefined;
}

function literalTypes(type: ts.TypeNode, context: PropertyContext): Finding[] {
  if (!ts.isTypeLiteralNode(type)) return [];

  return type.members.flatMap((member) => {
    if (ts.isMethodSignature(member) && member.type) {
      return propertyTypes(member.type, context);
    }

    if (!ts.isPropertySignature(member) || !member.type) return [];

    const property = member.name.getText();
    if (!isSelected(context, property)) return [];

    return propertyTypes(member.type, { ...context, property, selection: undefined });
  });
}

function referenceTypes(type: ts.TypeReferenceNode, context: PropertyContext): Finding[] {
  const { file, resolver, substitutions } = context;
  if (hasSubstitution(type, substitutions)) {
    const name = substitutionName(type);
    const substituted = name ? substitutions.get(name) : undefined;

    const sameType = substituted?.getText() === type.getText();

    return substituted && !sameType ? propertyTypes(substituted, context) : [];
  }

  const direct = apiOrService(type, file, resolver, context.packages);
  if (direct) return [{ node: type, file, name: direct, property: context.property }];

  const name = ts.isIdentifier(type.typeName) ? type.typeName.text : typeName(type.typeName);
  if (name === "Pick" || name === "Omit") return utilityTypes(type, name, context);

  if (name === "Readonly") {
    const target = type.typeArguments?.[0];

    return target ? propertyTypes(target, context) : [];
  }

  return declaredTypes(type, name, context);
}

function utilityTypes(
  type: ts.TypeReferenceNode,
  name: "Pick" | "Omit",
  context: PropertyContext,
): Finding[] {
  const target = type.typeArguments?.[0];
  if (!target) return [];

  const keys = new Set(
    type.typeArguments?.slice(1).flatMap((item) => {
      return literalStrings(item);
    }),
  );

  return propertyTypes(target, { ...context, selection: { name, keys } });
}

function declaredTypes(
  type: ts.TypeReferenceNode,
  name: string,
  context: PropertyContext,
): Finding[] {
  const { file, resolver, substitutions, visited } = context;
  const target = declaration(file, name, resolver);
  if (!target) return [];

  const key = `${target.file}:${name}:${type.getText()}`;
  if (visited.has(key)) return [];

  visited.add(key);
  const next = genericSubstitutions(target.node, type, substitutions);

  const nested: PropertyContext = { ...context, file: target.file, substitutions: next };
  if (ts.isTypeAliasDeclaration(target.node)) return propertyTypes(target.node.type, nested);

  if (!ts.isInterfaceDeclaration(target.node)) return [];

  return target.node.members.flatMap((member) => {
    if (ts.isMethodSignature(member) && member.type) {
      return propertyTypes(member.type, nested);
    }

    if (!ts.isPropertySignature(member) || !member.type) return [];

    const property = member.name.getText();
    if (!isSelected(nested, property)) return [];

    return propertyTypes(member.type, { ...nested, property, selection: undefined });
  });
}

function genericSubstitutions(
  node: ts.Node,
  type: ts.TypeReferenceNode,
  substitutions: ReadonlyMap<string, ts.TypeNode>,
): Map<string, ts.TypeNode> {
  const next = new Map(substitutions);
  const generic = ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node);
  if (!generic) return next;

  node.typeParameters?.forEach((parameter, index) => {
    const argument = type.typeArguments?.[index] ?? parameter.default;
    if (argument) next.set(parameter.name.text, substituteType(argument, substitutions));
  });

  return next;
}

function unsupportedSyntax(type: ts.TypeNode): boolean {
  const predicates = [
    ts.isConditionalTypeNode,
    ts.isIndexedAccessTypeNode,
    ts.isMappedTypeNode,
    ts.isInferTypeNode,
    ts.isTypeQueryNode,
  ];

  return predicates.some((predicate) => predicate(type));
}

function isIdentifierReference(type: ts.TypeNode): type is ts.TypeReferenceNode {
  return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName);
}

function unsupportedComputedType(
  type: ts.TypeNode,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): boolean {
  if (unsupportedSyntax(type)) return true;

  if (ts.isParenthesizedTypeNode(type)) {
    return unsupportedComputedType(type.type, file, resolver, visited);
  }

  if (unionOrIntersection(type)) {
    return type.types.some((item) => unsupportedComputedType(item, file, resolver, visited));
  }

  if (ts.isTypeLiteralNode(type)) return unsupportedMembers(type, file, resolver, visited);

  if (isIdentifierReference(type)) {
    const interfaceComputed = unsupportedInterface(type, file, resolver, visited);
    if (interfaceComputed) return true;

    return unsupportedReference(type, file, resolver, visited);
  }

  return false;
}

function unsupportedInterface(
  type: ts.TypeReferenceNode,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): boolean {
  const target = declaration(file, typeName(type.typeName), resolver);
  if (!target || !ts.isInterfaceDeclaration(target.node)) return false;

  return target.node.members.some((member) => {
    const typedMember = ts.isPropertySignature(member) || ts.isMethodSignature(member);
    if (!typedMember) return false;

    return !!member.type && unsupportedComputedType(member.type, target.file, resolver, visited);
  });
}

function unsupportedMembers(
  type: ts.TypeLiteralNode,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): boolean {
  return type.members.some((member) => {
    if (!ts.isPropertySignature(member) || !member.type) return false;

    return unsupportedComputedType(member.type, file, resolver, visited);
  });
}

function unsupportedReference(
  type: ts.TypeReferenceNode,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): boolean {
  if (!ts.isIdentifier(type.typeName)) return false;

  const name = type.typeName.text;
  const target = declaration(file, name, resolver);
  if (!target || !ts.isTypeAliasDeclaration(target.node)) return false;

  const key = `${target.file}:${name}`;
  if (visited.has(key)) return false;

  visited.add(key);

  return unsupportedComputedType(target.node.type, target.file, resolver, visited);
}

function unsupportedViolation(
  factory: ts.MethodDeclaration,
  file: string,
  parsed: ts.SourceFile,
): ArchitectureViolation {
  return {
    policy: "feature-app-factory",
    file,
    line: parsed.getLineAndCharacterOfPosition(factory.getStart(parsed)).line + 1,
    message:
      "Cannot verify computed FeatureSetup infrastructure type; declare a concrete technical record.",
    allowed:
      "Declare peer APIs in static dependencies and construct owned services inside the App factory; keep infrastructure technical.",
  };
}

function inspectFactory(
  factory: ts.MethodDeclaration,
  file: string,
  app: ClassifiedPackage,
  packages: readonly ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const parameter = factory.parameters[0];
  if (!parameter) return [];

  const infrastructure = setupInfrastructureType(parameter, file, resolver);
  if (!infrastructure) return [];

  const parsed = source(file);
  const findings = propertyTypes(infrastructure, {
    file,
    resolver,
    substitutions: new Map(),
    visited: new Set(),
    packages,
  });
  const violations = findings.map((finding) =>
    capabilityViolation(finding, file, app, packages, resolver, parsed),
  );

  return unsupportedComputedType(infrastructure, file, resolver)
    ? [...violations, unsupportedViolation(factory, file, parsed)]
    : violations;
}

function inspectAppFile(
  file: string,
  app: ClassifiedPackage,
  packages: readonly ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const parsed = source(file);

  return parsed.statements
    .filter(ts.isClassDeclaration)
    .flatMap((statement) =>
      statement.members
        .filter(
          (member): member is ts.MethodDeclaration =>
            ts.isMethodDeclaration(member) && member.name.getText(parsed) === "create",
        )
        .flatMap((factory) => inspectFactory(factory, file, app, packages, resolver)),
    );
}

function capabilityViolation(
  finding: Finding,
  file: string,
  app: ClassifiedPackage,
  packages: readonly ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
  parsed: ts.SourceFile,
): ArchitectureViolation {
  const targetFile = finding.name.split(":").slice(1).join(":");
  const targetFeature = appFeature(targetFile, packages);
  const capabilityName = finding.name.split(":", 1)[0] ?? "";
  const kind = capabilityName.endsWith("Api") ? "API" : "service";
  const owner = resolver.owningPackage({ file: targetFile });
  const detail = capabilityOwner(targetFeature, app.feature, owner?.name);

  return {
    policy: "feature-app-factory",
    file,
    line: parsed.getLineAndCharacterOfPosition(finding.node.getStart(parsed)).line + 1,
    message: `FeatureSetup infrastructure contains a ${kind} capability (${detail}).`,
    allowed:
      "Declare peer APIs in static dependencies and construct owned services inside the App factory; keep infrastructure technical.",
  };
}

function capabilityOwner(
  targetFeature: string | undefined,
  appFeatureName: string | undefined,
  packageName: string | undefined,
): string {
  if (targetFeature && targetFeature !== appFeatureName) return `foreign feature ${targetFeature}`;

  if (targetFeature) return `owned ${targetFeature}`;

  return packageName ?? "feature capability";
}

export function lintFeatureSetupInfrastructure(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const { packages, resolver } = snapshot;

  return packages
    .filter((pkg) => pkg.kind === "server" && pkg.layoutVersion === 0)
    .flatMap((pkg) => {
      const appRoot = join(pkg.root, "src", "app");
      if (!existsSync(appRoot)) return [];

      const files = snapshot.files({
        directory: appRoot,
        accept: (file) => /\.[cm]?[jt]sx?$/.test(file),
      });

      return files.flatMap((file) => inspectAppFile(file, pkg, packages, resolver));
    });
}
