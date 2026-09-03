import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const PROJECTION_WRITE_TYPES = new Set(["FoldProjectionStore", "ProjectionStore"]);
const PROJECTION_WRITE_METHODS = new Set(["storeProjection", "storeProjectionBatch"]);

type TypeDeclaration = ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

type PackageTypes = {
  importsByFile: ReadonlyMap<ts.SourceFile, ReadonlyMap<string, string>>;
  declarationsByName: ReadonlyMap<string, readonly TypeDeclaration[]>;
  sourceByPath: ReadonlyMap<string, ts.SourceFile>;
};

function isDomainServiceFile(path: string): boolean {
  return /\/server\/src\/services\/.+\.service\.ts$/.test(path);
}

function declarationName(node: ts.DeclarationName | undefined): string | null {
  if (node && (ts.isIdentifier(node) || ts.isStringLiteral(node))) {
    return node.text;
  }
  return null;
}

function referencedTypeName(node: ts.EntityName | ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isQualifiedName(node)) return node.right.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function importedTypeNames(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      names.set(element.name.text, importedName);
    }
  }

  return names;
}

function packageTypes(files: readonly string[]): PackageTypes {
  const importsByFile = new Map<ts.SourceFile, ReadonlyMap<string, string>>();
  const declarationsByName = new Map<string, TypeDeclaration[]>();
  const sourceByPath = new Map<string, ts.SourceFile>();

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    sourceByPath.set(file, sourceFile);
    importsByFile.set(sourceFile, importedTypeNames(sourceFile));

    for (const statement of sourceFile.statements) {
      const isTypeDeclaration =
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement);
      if (!isTypeDeclaration || !statement.name) continue;

      const declarations = declarationsByName.get(statement.name.text) ?? [];
      declarations.push(statement);
      declarationsByName.set(statement.name.text, declarations);
    }
  }

  return { importsByFile, declarationsByName, sourceByPath };
}

function memberExposesProjectionWrite(member: ts.TypeElement | ts.ClassElement): boolean {
  const isCapability =
    ts.isMethodSignature(member) ||
    ts.isMethodDeclaration(member) ||
    ts.isPropertySignature(member) ||
    ts.isPropertyDeclaration(member);
  if (!isCapability) return false;

  const name = declarationName(member.name);
  return name !== null && PROJECTION_WRITE_METHODS.has(name);
}

function memberTypeNodes(member: ts.TypeElement | ts.ClassElement): ts.TypeNode[] {
  if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
    return member.type ? [member.type] : [];
  }
  if (
    ts.isMethodSignature(member) ||
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  ) {
    const parameterTypes = member.parameters.flatMap((parameter) =>
      parameter.type ? [parameter.type] : [],
    );
    return member.type ? [...parameterTypes, member.type] : parameterTypes;
  }
  return [];
}

function isPrivateClassMember(member: ts.ClassElement): boolean {
  if (member.name && ts.isPrivateIdentifier(member.name)) return true;

  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : void 0;
  return Boolean(
    modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    ),
  );
}

function declarationExposesProjectionWrite(
  declaration: TypeDeclaration,
  types: PackageTypes,
  seen: Set<TypeDeclaration>,
): boolean {
  if (seen.has(declaration)) return false;
  seen.add(declaration);

  if (ts.isTypeAliasDeclaration(declaration)) {
    return typeExposesProjectionWrite(declaration.type, types, seen);
  }

  const exposedMembers = ts.isInterfaceDeclaration(declaration)
    ? [...declaration.members]
    : [...declaration.members].filter((member) => !isPrivateClassMember(member));
  if (exposedMembers.some(memberExposesProjectionWrite)) return true;

  const exposesNestedWrite = exposedMembers
    .flatMap(memberTypeNodes)
    .some((type) => typeExposesProjectionWrite(type, types, seen));
  if (exposesNestedWrite) return true;

  const heritageTypes = declaration.heritageClauses?.flatMap((clause) => clause.types) ?? [];
  return heritageTypes.some((type) => typeExposesProjectionWrite(type, types, seen));
}

function typeExposesProjectionWrite(
  node: ts.Node,
  types: PackageTypes,
  seen: Set<TypeDeclaration>,
): boolean {
  if (
    (ts.isMethodSignature(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node)) &&
    memberExposesProjectionWrite(node)
  ) {
    return true;
  }

  let reference: string | null = null;
  if (ts.isTypeReferenceNode(node)) {
    reference = referencedTypeName(node.typeName);
  } else if (ts.isExpressionWithTypeArguments(node)) {
    reference = referencedTypeName(node.expression);
  }
  if (reference) {
    const importedName = types.importsByFile.get(node.getSourceFile())?.get(reference);
    const canonicalName = importedName ?? reference;
    if (PROJECTION_WRITE_TYPES.has(canonicalName)) return true;

    const declarations = types.declarationsByName.get(canonicalName) ?? [];
    if (
      declarations.some((declaration) =>
        declarationExposesProjectionWrite(declaration, types, seen),
      )
    ) {
      return true;
    }
  }

  let exposesWrite = false;
  ts.forEachChild(node, (child) => {
    if (!exposesWrite && typeExposesProjectionWrite(child, types, seen)) {
      exposesWrite = true;
    }
  });
  return exposesWrite;
}

function serviceDependencyTypes(service: ts.ClassDeclaration): ts.TypeNode[] {
  const dependencies: ts.TypeNode[] = [];

  for (const member of service.members) {
    if (ts.isPropertyDeclaration(member) && member.type) {
      dependencies.push(member.type);
    }

    const isCallable =
      ts.isConstructorDeclaration(member) ||
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member);
    if (!isCallable) continue;

    for (const parameter of member.parameters) {
      if (parameter.type) dependencies.push(parameter.type);
    }
  }

  return dependencies;
}

function lintServiceFile(
  file: string,
  sourceFile: ts.SourceFile,
  types: PackageTypes,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const seen = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name?.text.endsWith("Service")) {
      continue;
    }

    for (const dependency of serviceDependencyTypes(statement)) {
      if (!typeExposesProjectionWrite(dependency, types, new Set())) continue;

      const dependencyText = dependency.getText(sourceFile);
      const key = `${statement.name.text}:${dependencyText}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const line =
        sourceFile.getLineAndCharacterOfPosition(dependency.getStart(sourceFile)).line + 1;
      violations.push({
        policy: "service-projection-write-boundary",
        file,
        line,
        message: `Service dependency ${JSON.stringify(dependencyText)} exposes projection writes.`,
        allowed:
          "Inject an explicit read-only projection/read-model port. ProjectionStore, FoldProjectionStore, and storeProjection* capabilities belong to projection or eventing adapters and composition roots.",
      });
    }
  }

  return violations;
}

/** Services may read projections but cannot receive their write capabilities. */
export function lintServiceProjectionBoundaries(
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const pkg of packages) {
    if (pkg.kind !== "server" || pkg.layoutVersion !== 0) continue;

    const sourceFiles = walkFiles(join(pkg.root, "src"), (file) => file.endsWith(".ts"));
    const types = packageTypes(sourceFiles);

    for (const file of sourceFiles.filter(isDomainServiceFile)) {
      const sourceFile = types.sourceByPath.get(file);
      if (!sourceFile) continue;
      violations.push(...lintServiceFile(file, sourceFile, types));
    }
  }

  return violations;
}
