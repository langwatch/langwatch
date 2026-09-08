import { readFileSync } from "node:fs";
import ts from "typescript";
import type { WorkspaceModuleResolver } from "./workspace/module-graph.ts";

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((m) => m.kind === kind));
}

export function hasPrivateAppConstructor(app: ts.ClassDeclaration): boolean {
  const constructors = app.members.filter(ts.isConstructorDeclaration);

  return (
    constructors.length > 0 &&
    constructors.every((item) => hasModifier(item, ts.SyntaxKind.PrivateKeyword))
  );
}

function parsed(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function importedName(name: ts.EntityName, bindings: ts.NamedImportBindings): string | undefined {
  if (ts.isNamespaceImport(bindings)) {
    const matchingNamespace =
      ts.isQualifiedName(name) &&
      ts.isIdentifier(name.left) &&
      name.left.text === bindings.name.text;

    return matchingNamespace ? name.right.text : void 0;
  }

  if (!ts.isIdentifier(name)) return void 0;

  const imported = bindings.elements.find((element) => element.name.text === name.text);

  return imported ? (imported.propertyName ?? imported.name).text : void 0;
}

function importedSetup(
  name: ts.EntityName,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): boolean {
  for (const declaration of parsed(file).statements.filter(ts.isImportDeclaration)) {
    const module = declaration.moduleSpecifier;
    const bindings = declaration.importClause?.namedBindings;
    if (!ts.isStringLiteral(module) || !bindings) continue;

    const original = importedName(name, bindings);
    if (!original) continue;

    if (module.text === "@langwatch/runtime-composition") return original === "FeatureSetup";

    const target = resolver.resolve({ file, specifier: module.text });

    return target ? setupAlias(original, target, resolver, visited) : false;
  }

  return false;
}

function setupAlias(
  name: string,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): boolean {
  const key = `${file}:${name}`;
  if (visited.has(key)) return false;

  visited.add(key);
  const declaration = parsed(file).statements.find(
    (item): item is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(item) && item.name.text === name,
  );

  return declaration ? canonicalSetup(declaration.type, file, resolver, visited) : false;
}

function canonicalSetup(
  type: ts.TypeNode | undefined,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): boolean {
  if (!type) return false;

  if (ts.isParenthesizedTypeNode(type)) return canonicalSetup(type.type, file, resolver, visited);

  if (!ts.isTypeReferenceNode(type)) return false;

  if (shadowedTypeParameter(type)) return false;

  if (importedSetup(type.typeName, file, resolver, visited)) return true;

  return ts.isIdentifier(type.typeName) && setupAlias(type.typeName.text, file, resolver, visited);
}

function declaredTypeParameters(
  node: ts.Node,
): ts.NodeArray<ts.TypeParameterDeclaration> | undefined {
  if (ts.isTypeAliasDeclaration(node)) return node.typeParameters;

  if (ts.isMethodDeclaration(node)) return node.typeParameters;

  if (ts.isClassDeclaration(node)) return node.typeParameters;

  return void 0;
}

function shadowedTypeParameter(type: ts.TypeReferenceNode): boolean {
  if (!ts.isIdentifier(type.typeName)) return false;

  const name = type.typeName.text;
  let parent = type.parent;
  while (parent) {
    const parameters = declaredTypeParameters(parent);
    if (parameters?.some((parameter) => parameter.name.text === name)) return true;

    parent = parent.parent;
  }

  return false;
}

export function hasCanonicalAppFactory(
  app: ts.ClassDeclaration,
  file: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  const factories = app.members.filter(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      member.name.getText() === "create" &&
      hasModifier(member, ts.SyntaxKind.StaticKeyword),
  );

  return (
    factories.length > 0 &&
    factories.every((factory) => {
      if (factory.parameters.length === 0) return true;

      if (factory.parameters.length !== 1) return false;

      const parameter = factory.parameters[0];
      if (!parameter) return false;

      const allowsAlternateInput =
        parameter.questionToken || parameter.dotDotDotToken || parameter.initializer;
      if (allowsAlternateInput) return false;

      return canonicalSetup(parameter.type, file, resolver);
    })
  );
}
