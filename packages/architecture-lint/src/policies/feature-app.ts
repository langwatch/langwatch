import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import ts from "typescript";
import { sourceFile, sourceText, type WorkspaceModuleResolver } from "../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage, FeatureCatalogueEntry } from "../types.ts";

/**
 * Three files folded into one concept: the contract vocabulary a feature API
 * must declare, the canonical factory shape its concrete app must have, and
 * the setup-infrastructure types a contract may not leak. Each keeps its own
 * registered policy id and its own `lint*` entry in policies/index.ts; only
 * the module they live in is shared.
 */

function source(file: string): ts.SourceFile {
  return sourceFile({ file });
}

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
/** A file with no `class` token declares no class, and is never parsed to find that out. */
function classDeclarations(file: string): ts.ClassDeclaration[] {
  if (!/\bclass\b/.test(sourceText({ file }))) return [];

  return source(file).statements.filter((item) => ts.isClassDeclaration(item));
}

function modifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((item) => item.kind === kind) ?? false)
  );
}

type InterfaceDeclaration = { file: string; node: ts.InterfaceDeclaration };
type VariableDeclaration = { file: string; node: ts.VariableDeclaration };
type ClassDeclaration = { file: string; node: ts.ClassDeclaration };
type ExportedDeclaration = InterfaceDeclaration | VariableDeclaration | ClassDeclaration;

function exportTarget(
  statement: ts.ExportDeclaration,
  name: string,
  resolver: WorkspaceModuleResolver,
  file: string,
  acceptsExport: (element: ts.ExportSpecifier) => boolean,
): { file: string; name: string } | undefined {
  if (statement.isTypeOnly) return void 0;

  const specifier = statement.moduleSpecifier;
  if (!specifier || !ts.isStringLiteral(specifier)) return void 0;

  const target = resolver.resolve({ file, specifier: specifier.text });
  if (!target) return void 0;

  if (!statement.exportClause) return { file: target, name };

  const isNamed = ts.isNamedExports(statement.exportClause);
  if (!isNamed) return void 0;

  const item = statement.exportClause.elements.find(
    (element) => element.name.text === name && acceptsExport(element),
  );

  return item ? { file: target, name: (item.propertyName ?? item.name).text } : void 0;
}

function featureApiCallParts(initializer: ts.CallExpression):
  | {
      expression: ts.Identifier;
      argument: ts.StringLiteral;
      typeName: ts.Identifier;
    }
  | undefined {
  if (!ts.isIdentifier(initializer.expression)) return void 0;

  if (initializer.arguments.length !== 1) return void 0;

  const argument = initializer.arguments[0];
  if (!argument || !ts.isStringLiteral(argument)) return void 0;

  const typeArgument = initializer.typeArguments?.[0];
  if (!typeArgument || !ts.isTypeReferenceNode(typeArgument)) return void 0;

  if (!ts.isIdentifier(typeArgument.typeName)) return void 0;

  return {
    expression: initializer.expression,
    argument,
    typeName: typeArgument.typeName,
  };
}

function exportedDeclaration<T extends ExportedDeclaration>(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  declarationOf: (statement: ts.Statement, name: string) => T | undefined,
  acceptsExport: (element: ts.ExportSpecifier) => boolean = () => true,
  visited = new Set<string>(),
): T | undefined {
  const key = `${file}:${name}`;
  const alreadyVisited = visited.has(key);
  if (alreadyVisited) return void 0;

  if (!existsSync(file)) return void 0;

  visited.add(key);
  for (const statement of source(file).statements) {
    const declaration = declarationOf(statement, name);
    const isExported = declaration !== void 0 && modifier(statement, ts.SyntaxKind.ExportKeyword);
    if (isExported) return declaration;

    if (!ts.isExportDeclaration(statement)) continue;

    const target = exportTarget(statement, name, resolver, file, acceptsExport);
    if (!target) continue;

    const found = exportedDeclaration(
      target.file,
      target.name,
      resolver,
      declarationOf,
      acceptsExport,
      visited,
    );
    if (found) return found;
  }

  return void 0;
}

function exportedInterface(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): InterfaceDeclaration | undefined {
  return exportedDeclaration(
    file,
    name,
    resolver,
    (statement, declarationName) =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === declarationName
        ? { file: statement.getSourceFile().fileName, node: statement }
        : void 0,
    () => true,
    visited,
  );
}

function exportedVariable(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): VariableDeclaration | undefined {
  return exportedDeclaration(
    file,
    name,
    resolver,
    (statement, declarationName) => {
      if (!ts.isVariableStatement(statement)) return void 0;

      const declaration = statement.declarationList.declarations.find(
        (item) => ts.isIdentifier(item.name) && item.name.text === declarationName,
      );

      return declaration ? { file: statement.getSourceFile().fileName, node: declaration } : void 0;
    },
    (element) => !element.isTypeOnly,
    visited,
  );
}

function exportedClass(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): ClassDeclaration | undefined {
  return exportedDeclaration(
    file,
    name,
    resolver,
    (statement, declarationName) =>
      ts.isClassDeclaration(statement) && statement.name?.text === declarationName
        ? { file: statement.getSourceFile().fileName, node: statement }
        : void 0,
    () => true,
    visited,
  );
}
function importedClass(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): ClassDeclaration | undefined {
  for (const statement of source(file).statements) {
    const isImport = ts.isImportDeclaration(statement);
    const hasStringSpecifier = isImport && ts.isStringLiteral(statement.moduleSpecifier);
    if (!hasStringSpecifier) continue;

    const bindings = statement.importClause?.namedBindings;
    const isNamedImport = bindings !== void 0 && ts.isNamedImports(bindings);
    if (!isNamedImport) continue;

    const item = bindings.elements.find((element) => element.name.text === name);
    if (!item) continue;

    const target = resolver.resolve({ file, specifier: statement.moduleSpecifier.text });
    if (target !== void 0)
      return exportedClass(target, (item.propertyName ?? item.name).text, resolver);
  }

  return exportedClass(file, name, resolver);
}

function importedInterface(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): InterfaceDeclaration | undefined {
  for (const statement of source(file).statements) {
    const isImport = ts.isImportDeclaration(statement);
    const hasStringSpecifier = isImport && ts.isStringLiteral(statement.moduleSpecifier);
    if (!hasStringSpecifier) continue;

    const bindings = statement.importClause?.namedBindings;
    const isNamedImport = bindings !== void 0 && ts.isNamedImports(bindings);
    if (!isNamedImport) continue;

    const item = bindings.elements.find((element) => element.name.text === name);
    if (!item) continue;

    const target = resolver.resolve({ file, specifier: statement.moduleSpecifier.text });
    if (target !== void 0)
      return exportedInterface(target, (item.propertyName ?? item.name).text, resolver);
  }

  return exportedInterface(file, name, resolver);
}

function importedVariable(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): VariableDeclaration | undefined {
  for (const statement of source(file).statements) {
    const isImport = ts.isImportDeclaration(statement);
    const hasStringSpecifier = isImport && ts.isStringLiteral(statement.moduleSpecifier);
    if (!hasStringSpecifier) continue;

    const bindings = statement.importClause?.namedBindings;
    const isNamedImport = bindings !== void 0 && ts.isNamedImports(bindings);
    if (!isNamedImport) continue;

    const item = bindings.elements.find((element) => element.name.text === name);
    if (!item) continue;

    const target = resolver.resolve({ file, specifier: statement.moduleSpecifier.text });
    if (target !== void 0)
      return exportedVariable(target, (item.propertyName ?? item.name).text, resolver);
  }

  return exportedVariable(file, name, resolver);
}

function appName(feature: string): string {
  return `${feature
    .split("-")
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join("")}App`;
}
function apiName(feature: string): string {
  return `${feature
    .split("-")
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join("")}Api`;
}
function appViolation(file: string, message: string, allowed: string): ArchitectureViolation {
  return {
    policy: "feature-app-contract",
    file,
    message,
    allowed: `${allowed} See dev/docs/adr/133-composition-spec.md.`,
  };
}
function hidden(member: ts.Node & { name?: ts.Node }): boolean {
  return (
    modifier(member, ts.SyntaxKind.PrivateKeyword) ||
    modifier(member, ts.SyntaxKind.ProtectedKeyword) ||
    Boolean(member.name && ts.isPrivateIdentifier(member.name))
  );
}
function canonicalToken(
  file: string,
  expression: ts.Expression | undefined,
  resolver: WorkspaceModuleResolver,
  feature?: string,
  canonicalFeatureFiles?: ReadonlyMap<string, string>,
): boolean {
  if (!expression || !ts.isIdentifier(expression)) return false;

  const declaration = importedVariable(file, expression.text, resolver);
  if (!declaration) return false;

  const expected = declaration.file.match(/([^/\\]+)\.api\.ts$/)?.[1];
  if (!expected || (feature && expected !== feature)) return false;

  return (
    declaration.node.name.getText() === apiName(expected) &&
    canonicalApiTokenDeclaration(declaration, resolver, canonicalFeatureFiles)
  );
}
function apiToken(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): VariableDeclaration | undefined {
  const declaration = importedVariable(file, name, resolver);
  if (!declaration || !declaration.file.endsWith(".api.ts")) return void 0;

  const feature = basename(declaration.file, ".api.ts");

  const isExpectedName = declaration.node.name.getText() === apiName(feature);

  return isExpectedName ? declaration : void 0;
}
function canonicalApiFile(file: string, feature: string): boolean {
  return file.includes(`/modules/${feature}/contract/src/${feature}.api.ts`);
}
function canonicalApiTokenDeclaration(
  declaration: VariableDeclaration,
  resolver: WorkspaceModuleResolver,
  canonicalFeatureFiles?: ReadonlyMap<string, string>,
): boolean {
  const initializer = declaration.node.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return false;

  const parts = featureApiCallParts(initializer);
  if (!parts) return false;

  const importedHelper = importedFeatureApi(declaration.file, parts.expression.text, resolver);
  if (importedHelper !== "@langwatch/runtime-composition") return false;

  const interfaceDeclaration = exportedInterface(declaration.file, parts.typeName.text, resolver);

  const matchesFeature = parts.argument.text === basename(declaration.file, ".api.ts");
  const matchesCanonicalFile = canonicalFeatureFiles
    ? canonicalFeatureFiles.get(parts.argument.text) === declaration.file
    : canonicalApiFile(declaration.file, parts.argument.text);

  return Boolean(interfaceDeclaration && matchesFeature && matchesCanonicalFile);
}

function validApiTokenVariable(
  declaration: ts.VariableDeclaration | undefined,
): ts.CallExpression | undefined {
  if (!declaration) return void 0;

  if (!ts.isVariableDeclaration(declaration)) return void 0;

  const initializer = declaration.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return void 0;

  return initializer;
}

function validApiTokenDeclaration(
  file: string,
  feature: string,
  api: ts.InterfaceDeclaration,
  resolver: WorkspaceModuleResolver,
): boolean {
  const statement = source(file).statements.find(
    (item) =>
      ts.isVariableStatement(item) &&
      modifier(item, ts.SyntaxKind.ExportKeyword) &&
      item.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === apiName(feature),
      ),
  );
  if (!statement || !ts.isVariableStatement(statement)) return false;

  const declaration = statement.declarationList.declarations.find(
    (d) => ts.isIdentifier(d.name) && d.name.text === apiName(feature),
  );
  const call = validApiTokenVariable(declaration);
  if (!call) return false;

  const argument = call.arguments[0];
  if (!ts.isIdentifier(call.expression)) return false;

  if (call.arguments.length !== 1) return false;

  if (!argument || !ts.isStringLiteral(argument)) return false;

  if (argument.text !== feature) return false;

  const typeArgument = call.typeArguments?.[0];
  if (!typeArgument || !ts.isTypeReferenceNode(typeArgument)) return false;

  if (!ts.isIdentifier(typeArgument.typeName)) return false;

  if (typeArgument.typeName.text !== api.name.text) return false;

  const helper = importedFeatureApi(file, call.expression.text, resolver);

  return helper === "@langwatch/runtime-composition";
}
function importedFeatureApi(
  file: string,
  localName: string,
  _resolver: WorkspaceModuleResolver,
): string | undefined {
  for (const statement of source(file).statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    const item = bindings.elements.find((element) => element.name.text === localName);
    const isFeatureApi = item !== void 0 && (item.propertyName ?? item.name).text === "moduleApi";
    if (isFeatureApi) return statement.moduleSpecifier.text;
  }

  return void 0;
}
function typeReferenceLeaks(
  type: ts.TypeReferenceNode,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): boolean {
  const name = type.typeName.getText();
  if (/(?:Service|Repository|App|Token)$/.test(name)) return true;

  if (!ts.isIdentifier(type.typeName)) return false;

  const typeName = type.typeName.text;
  const imported = importedClass(file, typeName, resolver);
  const importedName = imported?.node.name?.text;
  if (importedName && /(?:Service|Repository|App|Token)$/.test(importedName)) return true;

  const key = `${file}:${typeName}`;
  if (visited.has(key)) return false;

  visited.add(key);
  const alias = source(file).statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName,
  );

  return alias !== void 0 && typeLeaksImplementation(alias.type, file, resolver, visited);
}

function typeLeaksImplementation(
  type: ts.TypeNode | undefined,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): boolean {
  if (!type) return false;

  if (ts.isTypeReferenceNode(type)) {
    const referenceLeaks = typeReferenceLeaks(type, file, resolver, visited);
    if (referenceLeaks) return true;
  }

  let nested = false;
  ts.forEachChild(type, (child) => {
    const childLeaks =
      ts.isTypeNode(child) && typeLeaksImplementation(child, file, resolver, visited);
    if (childLeaks) nested = true;
  });

  return nested;
}
function validApiOperation(
  member: ts.TypeElement,
  file: string,
  resolver: WorkspaceModuleResolver,
): member is ts.MethodSignature {
  if (!ts.isMethodSignature(member)) return false;

  const name = memberName(member.name);
  if (name === void 0) return false;

  const reserved = new Set(["then", "constructor", "prototype", "__proto__"]);
  const lookup = /^(?:get|try)?(?:Service|App|Lookup)$|^lookup$/.test(name);

  return !reserved.has(name) && !lookup && !typeLeaksImplementation(member.type, file, resolver);
}

function apiOperations(
  api: ts.InterfaceDeclaration,
  resolver: WorkspaceModuleResolver,
): Set<string> {
  return new Set(
    api.members
      .filter((member) => validApiOperation(member, api.getSourceFile().fileName, resolver))
      .map((member) => memberName(member.name))
      .filter((name): name is string => name !== void 0),
  );
}

function memberName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return void 0;

  const isLiteralName =
    ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name);
  if (isLiteralName) return name.text;

  const isStringComputedName =
    ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression);
  if (isStringComputedName) return name.expression.text;

  return void 0;
}
function validContractApi(
  api: ts.InterfaceDeclaration | undefined,
  file: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  if (!api) return false;

  if (!modifier(api, ts.SyntaxKind.ExportKeyword)) return false;

  if (api.heritageClauses?.length) return false;

  if (api.members.length === 0) return false;

  return api.members.every((member) => validApiOperation(member, file, resolver));
}

function validContractToken(
  api: ts.InterfaceDeclaration | undefined,
  token: VariableDeclaration | undefined,
  file: string,
  feature: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  if (!api || !token) return false;

  if (!validApiTokenDeclaration(file, feature, api, resolver)) return false;

  return canonicalApiTokenDeclaration(token, resolver);
}
function contractViolations(
  snapshot: WorkspaceSnapshot,
  contractRoot: string,
  feature: string,
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const file = join(contractRoot, "src", `${feature}.api.ts`);
  const name = apiName(feature);
  const add = (message: string, allowed: string) => appViolation(file, message, allowed);
  if (!existsSync(file))
    return [
      add(
        "Every catalogue feature requires its canonical API contract.",
        `Add src/${feature}.api.ts exporting interface ${name} and const ${name}, then export both from src/index.ts.`,
      ),
    ];

  const modules = snapshot.files({
    directory: join(contractRoot, "src"),
    accept: (path) => path.endsWith(".api.ts") && !path.includes("/__tests__/"),
  });
  const violations: ArchitectureViolation[] = [];
  if (modules.length !== 1)
    violations.push(
      add(
        "A feature contract has more than one API module.",
        `Keep only src/${feature}.api.ts as the feature's public API.`,
      ),
    );

  const api = source(file).statements.find(
    (item): item is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(item) && item.name.text === name,
  );
  const validApi = validContractApi(api, file, resolver);
  if (!validApi) {
    violations.push(
      add(
        "A feature API must be one exported interface containing callable operations only.",
        `Export interface ${name} with method signatures; service fields and inheritance do not belong in the portable API.`,
      ),
    );
  }

  const token = exportedVariable(file, name, resolver);
  const validToken = validContractToken(api, token, file, feature, resolver);
  if (!validToken)
    violations.push(
      add(
        "A feature API must export its canonical moduleApi token.",
        `Export const ${name} = moduleApi<${name}>("${feature}") from src/${feature}.api.ts using @langwatch/runtime-composition.`,
      ),
    );

  const index = join(contractRoot, "src/index.ts");
  const exportedApi = exportedInterface(index, name, resolver);
  const exportedToken = exportedVariable(index, name, resolver);
  if (exportedApi?.file !== file || exportedToken?.file !== file)
    violations.push(
      add(
        "The canonical feature API is not exported from the contract root.",
        `Export { ${name} } from "./${feature}.api" in src/index.ts.`,
      ),
    );

  return violations;
}
function publicMembers(app: ts.ClassDeclaration): (ts.ClassElement | ts.ParameterDeclaration)[] {
  return app.members.flatMap((member): (ts.ClassElement | ts.ParameterDeclaration)[] => {
    if (!ts.isConstructorDeclaration(member)) return hidden(member) ? [] : [member];

    return member.parameters.filter(
      (parameter) => ts.isParameterPropertyDeclaration(parameter, member) && !hidden(parameter),
    );
  });
}
function hasTypeScriptPrivateImplementation(app: ts.ClassDeclaration): boolean {
  return app.members.some((member) => {
    if (ts.isConstructorDeclaration(member)) {
      return member.parameters.some(
        (parameter) =>
          ts.isParameterPropertyDeclaration(parameter, member) &&
          (modifier(parameter, ts.SyntaxKind.PrivateKeyword) ||
            modifier(parameter, ts.SyntaxKind.ProtectedKeyword)),
      );
    }

    if (!member.name) return true;

    if (ts.isPrivateIdentifier(member.name)) return false;

    const isTypeScriptPrivate =
      modifier(member, ts.SyntaxKind.PrivateKeyword) ||
      modifier(member, ts.SyntaxKind.ProtectedKeyword);

    return isTypeScriptPrivate;
  });
}
function validDefinedProperty(
  member: ts.PropertyDeclaration | ts.ParameterDeclaration,
  metadata: Set<string>,
  operations: Set<string>,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): boolean {
  const name = member.name.getText();
  if (!modifier(member, ts.SyntaxKind.StaticKeyword)) return false;

  if (!metadata.has(name)) return false;

  if (!modifier(member, ts.SyntaxKind.ReadonlyKeyword)) return false;

  if (ts.isParameter(member)) return false;

  if (name !== "contract") return true;

  const initializer = ts.isPropertyDeclaration(member) ? member.initializer : void 0;

  return Boolean(
    initializer &&
    canonicalToken(
      file,
      initializer,
      resolver,
      basename(contractFile, ".api.ts"),
      canonicalFeatureFiles,
    ),
  );
}
function isStaticCreate(member: ts.ClassElement): boolean {
  return (
    ts.isMethodDeclaration(member) &&
    modifier(member, ts.SyntaxKind.StaticKeyword) &&
    member.name.getText() === "create"
  );
}
function callableFieldName(
  member: ts.PropertyDeclaration,
  operations: Set<string>,
): string | undefined {
  const name = memberName(member.name);
  const initializer = member.initializer;
  if (!name) return void 0;

  if (!operations.has(name)) return void 0;

  if (member.questionToken) return void 0;

  if (!initializer) return void 0;

  const isCallable = ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer);

  return isCallable ? name : void 0;
}

function validConcreteMember(
  member: ts.ClassElement | ts.ParameterDeclaration,
  operations: Set<string>,
  metadata: Set<string>,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
  provided: Set<string>,
): boolean {
  const isInstanceProperty = ts.isPropertyDeclaration(member);
  if (isInstanceProperty && !modifier(member, ts.SyntaxKind.StaticKeyword)) {
    const name = callableFieldName(member, operations);
    if (!name) return false;

    provided.add(name);

    return true;
  }

  const isPropertyOrParameter = ts.isPropertyDeclaration(member) || ts.isParameter(member);
  if (isPropertyOrParameter) {
    return validDefinedProperty(
      member,
      metadata,
      operations,
      file,
      contractFile,
      resolver,
      canonicalFeatureFiles,
    );
  }

  const isStaticOrNonMethod =
    !ts.isMethodDeclaration(member) || modifier(member, ts.SyntaxKind.StaticKeyword);
  if (isStaticOrNonMethod) return isStaticCreate(member);

  const name = memberName(member.name);
  if (!name) return false;

  if (!operations.has(name)) return false;

  provided.add(name);

  return true;
}

function validDefinedConcreteSurface(
  app: ts.ClassDeclaration,
  operations: Set<string>,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): boolean {
  if (hasTypeScriptPrivateImplementation(app)) return false;

  const provided = new Set<string>();
  const metadata = new Set(["contract", "dependencies", "configSchema", "repositories"]);
  for (const member of publicMembers(app)) {
    if (
      !validConcreteMember(
        member,
        operations,
        metadata,
        file,
        contractFile,
        resolver,
        canonicalFeatureFiles,
        provided,
      )
    )
      return false;
  }

  return [...operations].every((operation) => provided.has(operation));
}
function canonicalPeerApi(
  file: string,
  expression: ts.Expression | undefined,
  resolver: WorkspaceModuleResolver,
  ownContractFile: string,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): boolean {
  if (!expression || !ts.isIdentifier(expression)) return false;

  const declaration = apiToken(file, expression.text, resolver);
  if (!declaration || declaration.file === ownContractFile) return false;

  const feature = basename(declaration.file, ".api.ts");

  if (!catalogueFeatures.has(feature)) return false;

  if (canonicalFeatureFiles.get(feature) !== declaration.file) return false;

  const declarationName = declaration.node.name.getText();
  if (declarationName !== apiName(feature)) return false;

  return canonicalApiTokenDeclaration(declaration, resolver, canonicalFeatureFiles);
}
function validDefinedDependencies(
  app: ts.ClassDeclaration,
  file: string,
  ownContractFile: string,
  resolver: WorkspaceModuleResolver,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): boolean {
  const declaration = app.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      member.name.getText() === "dependencies" &&
      modifier(member, ts.SyntaxKind.StaticKeyword),
  );
  if (!declaration?.initializer) return false;

  let dependencies: ts.Expression = declaration.initializer;
  if (ts.isIdentifier(dependencies)) {
    const dependencyName = dependencies.text;
    const local = source(file)
      .statements.flatMap((statement) =>
        ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
      )
      .find((item) => ts.isIdentifier(item.name) && item.name.text === dependencyName);
    dependencies = local?.initializer ?? dependencies;
  }

  if (!ts.isObjectLiteralExpression(dependencies)) return false;

  return dependencies.properties.every(
    (property) =>
      ts.isPropertyAssignment(property) &&
      canonicalPeerApi(
        file,
        property.initializer,
        resolver,
        ownContractFile,
        catalogueFeatures,
        canonicalFeatureFiles,
      ),
  );
}
function usesContract(
  app: ts.ClassDeclaration,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  if ((app.heritageClauses ?? []).some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword))
    return false;

  const heritage = app.heritageClauses;
  if (!heritage) return false;

  return heritage.some((clause) => implementsContract(clause, file, contractFile, resolver));
}

function implementsContract(
  clause: ts.HeritageClause,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  if (clause.token !== ts.SyntaxKind.ImplementsKeyword) return false;

  return clause.types.some((type) => {
    if (!ts.isIdentifier(type.expression)) return false;

    return importedInterface(file, type.expression.text, resolver)?.file === contractFile;
  });
}
function factoryViolations(
  app: ts.ClassDeclaration,
  file: string,
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  if (!hasPrivateAppConstructor(app)) {
    violations.push(
      appViolation(
        file,
        "A feature App must have an explicit private constructor.",
        "Construct the App only through its static create factory; make every constructor declaration private.",
      ),
    );
  }

  if (!hasCanonicalAppFactory(app, file, resolver)) {
    violations.push(
      appViolation(
        file,
        "A feature App factory accepts a noncanonical construction path.",
        "Use one required FeatureSetup parameter from @langwatch/runtime-composition, or no parameters when the App needs no setup. Remove legacy dependency bags, union inputs and compatibility overloads.",
      ),
    );
  }

  return violations;
}

function concreteAppViolations(
  snapshot: WorkspaceSnapshot,
  serverRoot: string,
  contractRoot: string,
  feature: string,
  resolver: WorkspaceModuleResolver,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): ArchitectureViolation[] {
  const contractFile = join(contractRoot, "src", `${feature}.api.ts`);
  if (!existsSync(contractFile)) return [];

  const api = exportedInterface(contractFile, apiName(feature), resolver);
  if (!api) return [];

  const operations = apiOperations(api.node, resolver);
  const violations: ArchitectureViolation[] = [];
  for (const file of productionFiles(snapshot, serverRoot))
    for (const statement of classDeclarations(file)) {
      const inheritedApp = hasInheritedApp(statement);
      if (inheritedApp) {
        violations.push(
          appViolation(
            file,
            "A concrete feature app may not inherit implementation state.",
            "Implement the feature API directly and keep implementation state in ECMAScript private members.",
          ),
        );
        continue;
      }

      if (!usesContract(statement, file, contractFile, resolver)) continue;

      violations.push(...factoryViolations(statement, file, resolver));

      const valid = validConcreteClass(
        statement,
        file,
        contractFile,
        resolver,
        operations,
        catalogueFeatures,
        canonicalFeatureFiles,
      );
      if (!valid)
        violations.push(
          appViolation(
            file,
            "A concrete feature app exposes a different public surface from its API contract.",
            "Implement only callable API operations; keep owned services and helpers private, and expose static readonly contract, dependencies, configSchema, repositories and create metadata.",
          ),
        );
    }

  return violations;
}

function validConcreteClass(
  statement: ts.ClassDeclaration,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
  operations: Set<string>,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): boolean {
  if (!hasContractProperty(statement)) return false;

  if (
    !validDefinedDependencies(
      statement,
      file,
      contractFile,
      resolver,
      catalogueFeatures,
      canonicalFeatureFiles,
    )
  )
    return false;

  return validDefinedConcreteSurface(
    statement,
    operations,
    file,
    contractFile,
    resolver,
    canonicalFeatureFiles,
  );
}

function hasInheritedApp(statement: ts.ClassDeclaration): boolean {
  const isNamedApp = statement.name?.text.endsWith("App") ?? false;
  if (!isNamedApp) return false;

  const heritage = statement.heritageClauses;
  if (!heritage) return false;

  return heritage.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
}

function hasContractProperty(statement: ts.ClassDeclaration): boolean {
  return statement.members.some((member) => {
    if (!ts.isPropertyDeclaration(member)) return false;

    if (member.name.getText() !== "contract") return false;

    return modifier(member, ts.SyntaxKind.StaticKeyword);
  });
}

function productionFiles(snapshot: WorkspaceSnapshot, root: string): readonly string[] {
  return snapshot.files({
    directory: join(root, "src"),
    accept: (path) => {
      const isTypeScript = path.endsWith(".ts") || path.endsWith(".tsx");
      if (!isTypeScript) return false;

      if (path.includes("/__tests__/")) return false;

      return !/(?:test|spec)\.tsx?$/.test(path);
    },
  });
}

function installerImports(parsed: ts.SourceFile): {
  legacyNames: Set<string>;
  definedNames: Set<string>;
  namespaces: Set<string>;
} {
  const legacyNames = new Set<string>();
  const definedNames = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of parsed.statements.filter(ts.isImportDeclaration)) {
    collectInstallerImport(statement, legacyNames, definedNames, namespaces);
  }

  return { legacyNames, definedNames, namespaces };
}

function collectInstallerImport(
  statement: ts.ImportDeclaration,
  legacyNames: Set<string>,
  definedNames: Set<string>,
  namespaces: Set<string>,
): void {
  const moduleName = statement.moduleSpecifier;
  if (!ts.isStringLiteral(moduleName) || moduleName.text !== "@langwatch/runtime-composition")
    return;

  const bindings = statement.importClause?.namedBindings;
  if (!bindings) return;

  if (ts.isNamespaceImport(bindings)) {
    namespaces.add(bindings.name.text);

    return;
  }

  for (const item of bindings.elements) {
    const imported = (item.propertyName ?? item.name).text;
    if (imported === "serverFeature") {
      legacyNames.add(item.name.text);
    }

    if (imported === "defineModule") {
      definedNames.add(item.name.text);
    }
  }
}

function isInstallerCall(
  node: ts.Node,
  imports: ReturnType<typeof installerImports>,
): { call: ts.CallExpression; kind: "legacy" | "defined" } | undefined {
  if (!ts.isCallExpression(node)) return void 0;

  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    if (imports.legacyNames.has(callee.text)) {
      return { call: node, kind: "legacy" };
    }

    if (imports.definedNames.has(callee.text)) {
      return { call: node, kind: "defined" };
    }

    return void 0;
  }

  if (!ts.isPropertyAccessExpression(callee)) return void 0;

  if (!ts.isIdentifier(callee.expression)) return void 0;

  if (!imports.namespaces.has(callee.expression.text)) {
    return void 0;
  }

  if (callee.name.text === "serverFeature") {
    return { call: node, kind: "legacy" };
  }

  if (callee.name.text === "defineModule") {
    return { call: node, kind: "defined" };
  }

  return void 0;
}

type Installer = {
  file: string;
  call: ts.CallExpression;
  providers: ts.CallExpression[];
  complete: boolean;
  kind: "legacy" | "defined";
  app?: ts.Expression;
  stages: string[];
};

function installerChain(file: string, node: ts.CallExpression, kind: Installer["kind"]): Installer {
  const providers: ts.CallExpression[] = [];
  let app: ts.Expression | undefined;
  const stages: string[] = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current.parent)) {
    const access = current.parent;
    stages.push(access.name.text);
    if (!ts.isCallExpression(access.parent)) break;

    if (access.name.text === "provides") {
      providers.push(access.parent);
    }

    const hasWithAppArgument = access.name.text === "withApp" && access.parent.arguments.length > 0;
    if (hasWithAppArgument) {
      app = access.parent.arguments[0];
    }

    current = access.parent;
  }

  const complete =
    ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === "build";

  return { file, call: node, providers, complete, kind, stages, ...(app ? { app } : {}) };
}

function installers(snapshot: WorkspaceSnapshot, serverRoot: string): Installer[] {
  const result: Installer[] = [];
  for (const file of productionFiles(snapshot, serverRoot)) {
    if (!sourceText({ file }).includes("@langwatch/runtime-composition")) continue;

    const parsed = source(file);
    const imports = installerImports(parsed);
    const visit = (node: ts.Node): void => {
      const installer = isInstallerCall(node, imports);
      if (installer) result.push(installerChain(file, installer.call, installer.kind));

      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }

  return result;
}

function installerViolations(
  declaration: Installer,
  pkg: ClassifiedPackage,
  contractRoot: string,
  resolver: WorkspaceModuleResolver,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): ArchitectureViolation[] {
  return declaration.kind === "defined"
    ? definedInstallerViolations(
        declaration,
        pkg,
        contractRoot,
        resolver,
        catalogueFeatures,
        canonicalFeatureFiles,
      )
    : [
        appViolation(
          declaration.file,
          "Legacy serverFeature installers are not accepted for catalogue features.",
          `Use defineModule("${pkg.feature}").withApp(${appName(pkg.feature ?? "")}).build() in the canonical installer.`,
        ),
      ];
}

function canonicalInstaller(
  file: string,
  call: ts.CallExpression,
  pkg: ClassifiedPackage,
): boolean {
  const id = call.arguments[0];
  const canonicalId = id !== void 0 && ts.isStringLiteral(id) && id.text === pkg.feature;
  const canonicalFile = file === join(pkg.root, "src", `${pkg.feature}.server.ts`);

  return canonicalId && canonicalFile;
}

function definedInstallerViolations(
  declaration: Installer,
  pkg: ClassifiedPackage,
  contractRoot: string,
  resolver: WorkspaceModuleResolver,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): ArchitectureViolation[] {
  const { file, call, providers } = declaration;
  const violations = canonicalInstaller(file, call, pkg)
    ? []
    : [
        appViolation(
          file,
          "The installer does not use its canonical feature name and location.",
          `Declare defineModule("${pkg.feature}") in src/${pkg.feature}.server.ts.`,
        ),
      ];
  const app = declaration.app;
  const appDeclaration =
    app && ts.isIdentifier(app) ? importedClass(file, app.text, resolver) : void 0;
  const contractFile = join(contractRoot, "src", `${pkg.feature}.api.ts`);
  const api = exportedInterface(contractFile, apiName(pkg.feature ?? ""), resolver);
  const token = exportedVariable(contractFile, apiName(pkg.feature ?? ""), resolver);
  const operations = api ? apiOperations(api.node, resolver) : new Set<string>();
  const validApp = validDefinedApp(
    api,
    token,
    appDeclaration,
    pkg.root,
    contractFile,
    resolver,
    operations,
    catalogueFeatures,
    canonicalFeatureFiles,
  );

  const hasValidStages = validDefinedStages(declaration.stages);
  const hasApp = app !== void 0;
  const hasNoProviders = providers.length === 0;
  if (!hasApp) return pushInvalidInstaller();

  if (!validApp) return pushInvalidInstaller();

  if (!hasNoProviders) return pushInvalidInstaller();

  if (!declaration.complete) return pushInvalidInstaller();

  const valid = hasValidStages;
  function pushInvalidInstaller(): ArchitectureViolation[] {
    violations.push(
      appViolation(
        file,
        "A defineModule installer must bind exactly one valid concrete app with no legacy builder stages.",
        `Use defineModule("${pkg.feature}").withApp(${appName(pkg.feature ?? "")}).build(); implement ${apiName(pkg.feature ?? "")} operations and expose only static API metadata and create.`,
      ),
    );

    return violations;
  }

  if (!valid) pushInvalidInstaller();

  return violations;
}

function validDefinedApp(
  api: InterfaceDeclaration | undefined,
  token: VariableDeclaration | undefined,
  appDeclaration: ClassDeclaration | undefined,
  packageRoot: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
  operations: Set<string>,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): boolean {
  if (!api || !token || !appDeclaration) return false;

  const isOutsidePackage = relative(packageRoot, appDeclaration.file).startsWith("..");
  if (isOutsidePackage) return false;

  const implementsOwnContract = usesContract(
    appDeclaration.node,
    appDeclaration.file,
    contractFile,
    resolver,
  );
  if (!implementsOwnContract) return false;

  if (
    !validDefinedDependencies(
      appDeclaration.node,
      appDeclaration.file,
      contractFile,
      resolver,
      catalogueFeatures,
      canonicalFeatureFiles,
    )
  )
    return false;

  return validDefinedConcreteSurface(
    appDeclaration.node,
    operations,
    appDeclaration.file,
    contractFile,
    resolver,
    canonicalFeatureFiles,
  );
}

/**
 * What a module may state after its app, each at most once: the doors it
 * opens, the background work it contributes, the one-shot work it exposes and
 * its event sourcing. Every one of them answers a declaration that is already
 * installable, so the order between them carries no meaning.
 */
const DECLARED_MODULE_STAGES = new Set([
  "withTransports",
  "withWorkers",
  "withTasks",
  "withEventing",
]);

function validDefinedStages(stages: string[]): boolean {
  const hasRepositories = stages[0] === "withRepositories";
  const appIndex = hasRepositories ? 1 : 0;
  if (stages[appIndex] !== "withApp") return false;
  // `build` is optional: every stage answers a declaration that is already
  // installable, so a module that states its last half is finished.
  const tail =
    stages.at(-1) === "build" ? stages.slice(appIndex + 1, -1) : stages.slice(appIndex + 1);
  if (tail.some((stage) => !DECLARED_MODULE_STAGES.has(stage))) return false;
  return new Set(tail).size === tail.length;
}

export function lintFeatureAppContracts(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue } = snapshot;
  const violations: ArchitectureViolation[] = [];
  const canonicalFeatureFiles = new Map(
    catalogue.map((item) => [
      item.id,
      join(root, item.root, "contract", "src", `${item.id}.api.ts`),
    ]),
  );
  for (const owner of catalogue) {
    violations.push(
      ...lintFeatureOwner(
        snapshot,
        owner,
        snapshot.packages,
        snapshot.resolver,
        new Set(catalogue.map((item) => item.id)),
        canonicalFeatureFiles,
      ),
    );
  }

  return violations;
}

function lintFeatureOwner(
  snapshot: WorkspaceSnapshot,
  owner: FeatureCatalogueEntry,
  packages: readonly ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): ArchitectureViolation[] {
  const ownerRoot = join(snapshot.root, owner.root);
  const isEnterprise = owner.classification === "enterprise";
  const surfaces = packages.filter(
    (pkg) => pkg.feature === owner.id && pkg.enterprise === isEnterprise,
  );
  const server = surfaces.find((pkg) => pkg.kind === "server");
  if (!server) return [];

  const contract = surfaces.find((pkg) => pkg.kind === "contract");
  const contractRoot = contract?.root ?? join(ownerRoot, "contract");
  const violations = contract
    ? []
    : [
        appViolation(
          contractRoot,
          `Catalogue feature "${owner.id}" has no portable contract package.`,
          "Give the feature its real portable app and service contracts, including browser-owned behaviour; do not create an empty app or invent a server package.",
        ),
      ];
  violations.push(...contractViolations(snapshot, contractRoot, owner.id, resolver));
  for (const surface of surfaces) {
    if (surface.kind === "server" || surface.kind === "web")
      violations.push(
        ...concreteAppViolations(
          snapshot,
          surface.root,
          contractRoot,
          owner.id,
          resolver,
          catalogueFeatures,
          canonicalFeatureFiles,
        ),
      );
  }

  const declarations = installers(snapshot, server.root);
  if (declarations.length === 0) {
    const installerFile = join(server.root, "src", `${owner.id}.server.ts`);
    const hidden = existsSync(installerFile);
    violations.push(
      appViolation(
        installerFile,
        hidden
          ? "The canonical installer hides its defineModule declaration."
          : `Catalogue feature "${owner.id}" has no canonical server installer.`,
        hidden
          ? "Call the runtime-composition defineModule factory directly in the canonical installer; do not hide registration behind wrappers or local aliases."
          : "Move the existing construction into defineModule(...).withApp(...), then rewire API, worker and task composition to reuse that installer.",
      ),
    );

    return violations;
  }

  if (declarations.length !== 1) {
    violations.push(
      appViolation(
        server.root,
        "A feature declares multiple server installers.",
        "Keep one feature-owned installer and reuse it across process roles.",
      ),
    );
  }

  for (const declaration of declarations) {
    violations.push(
      ...installerViolations(
        declaration,
        server,
        contractRoot,
        resolver,
        catalogueFeatures,
        canonicalFeatureFiles,
      ),
    );
  }

  return violations;
}
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
  if (!owner || !owner.directory.includes(`${sep}modules${sep}`)) return undefined;

  const feature = appFeature(local.file, packages);
  const expected = feature
    ?.split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
  const serviceFile =
    local.file.includes(`${sep}modules${sep}`) && /\.service\.[^/]+$/.test(local.file);
  const declaredName = declarationName(local.node, short);
  const canonicalName =
    !expected || declaredName === `${expected}Api` || declaredName === `${expected}Service`;
  const ownServiceClass =
    ts.isClassDeclaration(local.node) && (serviceFile || declaredName.endsWith("Service"));
  const ownCanonicalService = declaredName.endsWith("Service") && canonicalName;
  const moduleApi = declaredName.endsWith("Api") && local.file.includes(".api.");
  if (!moduleApi && !ownServiceClass && !ownCanonicalService) {
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
