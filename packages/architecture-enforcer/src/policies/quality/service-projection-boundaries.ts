import { join } from "node:path";

import { FEATURE_PREFIX } from "@langwatch/oxlint-rules/grammar/feature-layout-policy.mjs";
import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { defineTreeFacts, mayMention } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

const PROJECTION_WRITE_TYPES = new Set(["FoldProjectionStore", "ProjectionStore"]);
const PROJECTION_WRITE_METHODS = new Set(["storeProjection", "storeProjectionBatch"]);

const PROJECTION_WRITE_WORDS = [...PROJECTION_WRITE_TYPES, ...PROJECTION_WRITE_METHODS];

type TypeDeclaration = ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** What a type node exposes itself, and the names it reaches through its file's imports. */
type TypeFacts = { exposesWrite: boolean; references: readonly string[] };

type DeclarationFacts = TypeFacts & { name: string };

type DependencyFacts = TypeFacts & { text: string; line: number };

type FileFacts = {
  declarations: readonly DeclarationFacts[];
  services: readonly { name: string; dependencies: readonly DependencyFacts[] }[];
};

const DOMAIN_SERVICE_FILE = new RegExp(`/process/src/${FEATURE_PREFIX}services/.+\\.service\\.ts$`);

function isDomainServiceFile(path: string): boolean {
  return DOMAIN_SERVICE_FILE.test(path);
}

function declarationName(node: ts.DeclarationName | undefined): string | null {
  if (!node) return null;

  if (ts.isIdentifier(node)) return node.text;

  if (ts.isStringLiteral(node)) return node.text;

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

function signatureTypeNodes(
  member:
    | ts.MethodSignature
    | ts.MethodDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): ts.TypeNode[] {
  const parameterTypes = member.parameters.flatMap((parameter) =>
    parameter.type ? [parameter.type] : [],
  );

  return member.type ? [...parameterTypes, member.type] : parameterTypes;
}

function memberTypeNodes(member: ts.TypeElement | ts.ClassElement): ts.TypeNode[] {
  if (ts.isPropertySignature(member)) return member.type ? [member.type] : [];

  if (ts.isPropertyDeclaration(member)) return member.type ? [member.type] : [];

  if (ts.isMethodSignature(member)) return signatureTypeNodes(member);

  if (ts.isMethodDeclaration(member)) return signatureTypeNodes(member);

  if (ts.isGetAccessorDeclaration(member)) return signatureTypeNodes(member);

  if (ts.isSetAccessorDeclaration(member)) return signatureTypeNodes(member);

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

function memberNodeExposesProjectionWrite(node: ts.Node): boolean {
  const isMember =
    ts.isMethodSignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node);

  return isMember && memberExposesProjectionWrite(node);
}

/** The facts of `nodes` and all beneath them: a write member, and every type name referenced. */
function typeFacts(nodes: readonly ts.Node[], imports: ReadonlyMap<string, string>): TypeFacts {
  let exposesWrite = false;
  const references: string[] = [];

  const visit = (node: ts.Node): void => {
    if (memberNodeExposesProjectionWrite(node)) exposesWrite = true;

    let reference: string | null = null;
    if (ts.isTypeReferenceNode(node)) reference = referencedTypeName(node.typeName);
    else if (ts.isExpressionWithTypeArguments(node))
      reference = referencedTypeName(node.expression);
    if (reference) references.push(imports.get(reference) ?? reference);

    ts.forEachChild(node, visit);
  };

  for (const node of nodes) visit(node);

  return { exposesWrite, references };
}

function declarationFacts(
  declaration: TypeDeclaration,
  imports: ReadonlyMap<string, string>,
): TypeFacts {
  if (ts.isTypeAliasDeclaration(declaration)) return typeFacts([declaration.type], imports);

  const exposedMembers = ts.isInterfaceDeclaration(declaration)
    ? [...declaration.members]
    : [...declaration.members].filter((member) => !isPrivateClassMember(member));
  const heritageTypes = declaration.heritageClauses?.flatMap((clause) => clause.types) ?? [];
  const facts = typeFacts([...exposedMembers.flatMap(memberTypeNodes), ...heritageTypes], imports);

  return {
    ...facts,
    exposesWrite: facts.exposesWrite || exposedMembers.some(memberExposesProjectionWrite),
  };
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

function fileFacts({ file, source }: { file: string; source: ts.SourceFile }): FileFacts {
  const imports = importedTypeNames(source);
  const declarations: DeclarationFacts[] = [];
  const services: FileFacts["services"][number][] = [];

  for (const statement of source.statements) {
    const isTypeDeclaration =
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement);

    if (!isTypeDeclaration || !statement.name) continue;

    declarations.push({ name: statement.name.text, ...declarationFacts(statement, imports) });
  }

  if (!isDomainServiceFile(file)) return { declarations, services };

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;

    const name = statement.name?.text;
    if (!name?.endsWith("Service")) continue;

    const dependencies = serviceDependencyTypes(statement).map((dependency) => ({
      text: dependency.getText(source),
      line: source.getLineAndCharacterOfPosition(dependency.getStart(source)).line + 1,
      ...typeFacts([dependency], imports),
    }));
    services.push({ name, dependencies });
  }

  return { declarations, services };
}

/** Derived wherever a process file is parsed, so this policy reads facts rather than trees. */
const processFileFacts = defineTreeFacts({
  accept: (file) => file.endsWith(".ts") && file.includes("/process/src/"),
  derive: fileFacts,
});

/** Whether `facts` reaches a projection write via the package's declarations, each seen once. */
function exposesProjectionWrite(
  facts: TypeFacts,
  declarationsByName: ReadonlyMap<string, readonly DeclarationFacts[]>,
  seen: Set<DeclarationFacts>,
): boolean {
  if (facts.exposesWrite) return true;

  for (const reference of facts.references) {
    if (PROJECTION_WRITE_TYPES.has(reference)) return true;

    for (const declaration of declarationsByName.get(reference) ?? []) {
      if (seen.has(declaration)) continue;

      seen.add(declaration);
      if (exposesProjectionWrite(declaration, declarationsByName, seen)) return true;
    }
  }

  return false;
}

function lintServiceFile(
  file: string,
  facts: FileFacts,
  declarationsByName: ReadonlyMap<string, readonly DeclarationFacts[]>,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const seen = new Set<string>();

  for (const service of facts.services) {
    for (const dependency of service.dependencies) {
      if (!exposesProjectionWrite(dependency, declarationsByName, new Set())) continue;

      const key = `${service.name}:${dependency.text}`;
      if (seen.has(key)) continue;

      seen.add(key);

      violations.push({
        policy: "service-projection-write-boundary",
        file,
        line: dependency.line,
        message: `Service dependency ${JSON.stringify(dependency.text)} exposes projection writes.`,
        allowed:
          "Inject an explicit read-only projection/read-model port. ProjectionStore, FoldProjectionStore, and storeProjection* capabilities belong to projection or eventing adapters and composition roots.",
      });
    }
  }

  return violations;
}

/** Services may read projections but cannot receive their write capabilities. */
export function lintServiceProjectionBoundaries(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const packages = snapshot.packages;

  const violations: ArchitectureViolation[] = [];

  for (const pkg of packages) {
    if (pkg.kind !== "process") continue;

    const sourceFiles = snapshot.files({
      directory: join(pkg.root, "src"),
      accept: (file) => file.endsWith(".ts"),
    });

    // Every finding names one of these words, so a package naming none is clean unparsed.
    const services = sourceFiles.filter(isDomainServiceFile);
    if (services.length === 0) continue;

    if (!sourceFiles.some((file) => mayMention({ file, words: PROJECTION_WRITE_WORDS }))) continue;

    const declarationsByName = new Map<string, DeclarationFacts[]>();
    for (const file of sourceFiles) {
      for (const declaration of processFileFacts(file).declarations) {
        const declarations = declarationsByName.get(declaration.name) ?? [];
        declarations.push(declaration);
        declarationsByName.set(declaration.name, declarations);
      }
    }

    for (const file of services) {
      violations.push(...lintServiceFile(file, processFileFacts(file), declarationsByName));
    }
  }

  return violations;
}
