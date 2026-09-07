import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files.ts";
import type { WorkspaceModuleResolver } from "./module-graph.ts";
import type { ArchitectureViolation, ClassifiedPackage, FeatureCatalogueEntry } from "./types.ts";

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function modifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((item) => item.kind === kind) ?? false)
  );
}

type InterfaceDeclaration = { file: string; node: ts.InterfaceDeclaration };
type VariableDeclaration = { file: string; node: ts.VariableDeclaration };

function exportedInterface(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): InterfaceDeclaration | undefined {
  const key = `${file}:${name}`;
  if (visited.has(key) || !existsSync(file)) return void 0;
  visited.add(key);
  for (const statement of source(file).statements) {
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === name &&
      modifier(statement, ts.SyntaxKind.ExportKeyword)
    )
      return { file, node: statement };
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const target = resolver.resolve({ file, specifier: specifier.text });
    if (!target) continue;
    if (!statement.exportClause) {
      const found = exportedInterface(target, name, resolver, visited);
      if (found) return found;
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const item = statement.exportClause.elements.find((element) => element.name.text === name);
    const found =
      item && exportedInterface(target, (item.propertyName ?? item.name).text, resolver, visited);
    if (found) return found;
  }
  return void 0;
}

function exportedVariable(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): VariableDeclaration | undefined {
  const key = `${file}:${name}`;
  if (visited.has(key) || !existsSync(file)) return void 0;
  visited.add(key);
  for (const statement of source(file).statements) {
    if (ts.isVariableStatement(statement) && modifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const declaration = statement.declarationList.declarations.find(
        (item) => ts.isIdentifier(item.name) && item.name.text === name,
      );
      if (declaration) return { file, node: declaration };
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const target = resolver.resolve({ file, specifier: specifier.text });
    if (!target) continue;
    if (!statement.exportClause) {
      const found = exportedVariable(target, name, resolver, visited);
      if (found) return found;
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const item = statement.exportClause.elements.find(
      (element) => element.name.text === name && !element.isTypeOnly,
    );
    const found =
      item && exportedVariable(target, (item.propertyName ?? item.name).text, resolver, visited);
    if (found) return found;
  }
  return void 0;
}

type ClassDeclaration = { file: string; node: ts.ClassDeclaration };
function exportedClass(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): ClassDeclaration | undefined {
  const key = `${file}:${name}`;
  if (visited.has(key) || !existsSync(file)) return void 0;
  visited.add(key);
  for (const statement of source(file).statements) {
    if (
      ts.isClassDeclaration(statement) &&
      statement.name?.text === name &&
      modifier(statement, ts.SyntaxKind.ExportKeyword)
    )
      return { file, node: statement };
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const target = resolver.resolve({ file, specifier: specifier.text });
    if (!target) continue;
    if (!statement.exportClause) {
      const found = exportedClass(target, name, resolver, visited);
      if (found) return found;
    } else if (ts.isNamedExports(statement.exportClause)) {
      const item = statement.exportClause.elements.find((element) => element.name.text === name);
      const found =
        item && exportedClass(target, (item.propertyName ?? item.name).text, resolver, visited);
      if (found) return found;
    }
  }
  return void 0;
}
function importedClass(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): ClassDeclaration | undefined {
  for (const statement of source(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const item = bindings.elements.find((element) => element.name.text === name);
    if (!item) continue;
    const target = resolver.resolve({ file, specifier: statement.moduleSpecifier.text });
    if (target) return exportedClass(target, (item.propertyName ?? item.name).text, resolver);
  }
  return exportedClass(file, name, resolver);
}

function importedInterface(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): InterfaceDeclaration | undefined {
  for (const statement of source(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const item = bindings.elements.find((element) => element.name.text === name);
    if (!item) continue;
    const target = resolver.resolve({ file, specifier: statement.moduleSpecifier.text });
    if (target) return exportedInterface(target, (item.propertyName ?? item.name).text, resolver);
  }
  return exportedInterface(file, name, resolver);
}

function importedVariable(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): VariableDeclaration | undefined {
  for (const statement of source(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const item = bindings.elements.find((element) => element.name.text === name);
    if (!item) continue;
    const target = resolver.resolve({ file, specifier: statement.moduleSpecifier.text });
    if (target) return exportedVariable(target, (item.propertyName ?? item.name).text, resolver);
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
  return declaration.node.name.getText() === apiName(feature) ? declaration : void 0;
}
function canonicalApiFile(file: string, feature: string): boolean {
  return file.includes(`/features/${feature}/contract/src/${feature}.api.ts`);
}
function canonicalApiTokenDeclaration(
  declaration: VariableDeclaration,
  resolver: WorkspaceModuleResolver,
  canonicalFeatureFiles?: ReadonlyMap<string, string>,
): boolean {
  const initializer = declaration.node.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return false;
  const argument = initializer.arguments[0];
  const typeArgument = initializer.typeArguments?.[0];
  if (
    !ts.isIdentifier(initializer.expression) ||
    initializer.arguments.length !== 1 ||
    !argument ||
    !ts.isStringLiteral(argument) ||
    !typeArgument ||
    !ts.isTypeReferenceNode(typeArgument) ||
    !ts.isIdentifier(typeArgument.typeName) ||
    importedFeatureApi(declaration.file, initializer.expression.text, resolver) !==
      "@langwatch/runtime-composition/contract"
  )
    return false;
  const interfaceDeclaration = exportedInterface(
    declaration.file,
    typeArgument.typeName.text,
    resolver,
  );
  return Boolean(
    interfaceDeclaration &&
    argument.text === basename(declaration.file, ".api.ts") &&
    (canonicalFeatureFiles?.get(argument.text) === declaration.file ||
      (!canonicalFeatureFiles && canonicalApiFile(declaration.file, argument.text))),
  );
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
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !ts.isCallExpression(declaration.initializer)
  )
    return false;
  const call = declaration.initializer;
  const argument = call.arguments[0];
  if (
    !ts.isIdentifier(call.expression) ||
    call.arguments.length !== 1 ||
    !argument ||
    !ts.isStringLiteral(argument) ||
    argument.text !== feature
  )
    return false;
  const typeArgument = call.typeArguments?.[0];
  if (
    !typeArgument ||
    !ts.isTypeReferenceNode(typeArgument) ||
    !ts.isIdentifier(typeArgument.typeName) ||
    typeArgument.typeName.text !== api.name.text
  )
    return false;
  const helper = importedFeatureApi(file, call.expression.text, resolver);
  return helper === "@langwatch/runtime-composition/contract";
}
function importedFeatureApi(
  file: string,
  localName: string,
  _resolver: WorkspaceModuleResolver,
): string | undefined {
  for (const statement of source(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const item = bindings.elements.find((element) => element.name.text === localName);
    if (item && (item.propertyName ?? item.name).text === "featureApi")
      return statement.moduleSpecifier.text;
  }
  return void 0;
}
function typeLeaksImplementation(
  type: ts.TypeNode | undefined,
  file: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): boolean {
  if (!type) return false;
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText();
    if (/(?:Service|Repository|App|Token)$/.test(name)) return true;
    const imported = ts.isIdentifier(type.typeName)
      ? importedClass(file, type.typeName.text, resolver)
      : void 0;
    if (
      imported?.node.name?.text &&
      /(?:Service|Repository|App|Token)$/.test(imported.node.name.text)
    )
      return true;
    if (ts.isIdentifier(type.typeName) && !visited.has(`${file}:${type.typeName.text}`)) {
      const typeName = type.typeName.text;
      visited.add(`${file}:${typeName}`);
      const alias = source(file).statements.find(
        (statement): statement is ts.TypeAliasDeclaration =>
          ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName,
      );
      if (alias && typeLeaksImplementation(alias.type, file, resolver, visited)) return true;
    }
  }
  let nested = false;
  ts.forEachChild(type, (child) => {
    if (ts.isTypeNode(child) && typeLeaksImplementation(child, file, resolver, visited))
      nested = true;
  });
  return nested;
}
function apiOperations(
  api: ts.InterfaceDeclaration,
  resolver: WorkspaceModuleResolver,
): Set<string> {
  return new Set(
    api.members
      .filter(ts.isMethodSignature)
      .filter((member) => {
        const name = memberName(member.name);
        if (name === void 0) return false;
        const returnType = member.type;
        const leakedType = typeLeaksImplementation(
          returnType,
          api.getSourceFile().fileName,
          resolver,
        );
        return (
          name !== "then" &&
          name !== "constructor" &&
          name !== "prototype" &&
          name !== "__proto__" &&
          !/^(?:get|try)?(?:Service|App|Lookup)$|^lookup$/.test(name) &&
          !leakedType
        );
      })
      .map((member) => memberName(member.name))
      .filter((name): name is string => name !== void 0),
  );
}

function memberName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return void 0;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression))
    return name.expression.text;
  return void 0;
}
function contractViolations(
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
  const modules = walkFiles(
    join(contractRoot, "src"),
    (path) => path.endsWith(".api.ts") && !path.includes("/__tests__/"),
  );
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
  if (
    !api ||
    !modifier(api, ts.SyntaxKind.ExportKeyword) ||
    api.heritageClauses?.length ||
    api.members.length === 0 ||
    api.members.some((member) => !ts.isMethodSignature(member)) ||
    apiOperations(api, resolver).size !== api.members.length
  ) {
    violations.push(
      add(
        "A feature API must be one exported interface containing callable operations only.",
        `Export interface ${name} with method signatures; service fields and inheritance do not belong in the portable API.`,
      ),
    );
  }
  const token = exportedVariable(file, name, resolver);
  if (
    !api ||
    !token ||
    !validApiTokenDeclaration(file, feature, api, resolver) ||
    !canonicalApiTokenDeclaration(token, resolver)
  )
    violations.push(
      add(
        "A feature API must export its canonical featureApi token.",
        `Export const ${name} = featureApi<${name}>("${feature}") from src/${feature}.api.ts using @langwatch/runtime-composition/contract.`,
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
    return (
      !member.name ||
      (!ts.isPrivateIdentifier(member.name) &&
        (modifier(member, ts.SyntaxKind.PrivateKeyword) ||
          modifier(member, ts.SyntaxKind.ProtectedKeyword)))
    );
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
  if (
    !metadata.has(name) ||
    !modifier(member, ts.SyntaxKind.ReadonlyKeyword) ||
    ts.isParameter(member)
  )
    return false;
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
  const metadata = new Set(["contract", "dependencies", "configSchema"]);
  for (const member of publicMembers(app)) {
    if (ts.isPropertyDeclaration(member) || ts.isParameter(member)) {
      if (
        !validDefinedProperty(
          member,
          metadata,
          operations,
          file,
          contractFile,
          resolver,
          canonicalFeatureFiles,
        )
      )
        return false;
      continue;
    }
    if (!ts.isMethodDeclaration(member) || modifier(member, ts.SyntaxKind.StaticKeyword)) {
      if (!isStaticCreate(member)) return false;
      continue;
    }
    const name = memberName(member.name);
    if (!name || !operations.has(name)) return false;
    provided.add(name);
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
  return (
    catalogueFeatures.has(feature) &&
    canonicalFeatureFiles.get(feature) === declaration.file &&
    declaration.node.name.getText() === apiName(feature) &&
    canonicalApiTokenDeclaration(declaration, resolver, canonicalFeatureFiles)
  );
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
  return (
    app.heritageClauses?.some(
      (clause) =>
        clause.token === ts.SyntaxKind.ImplementsKeyword &&
        clause.types.some(
          (type) =>
            ts.isIdentifier(type.expression) &&
            importedInterface(file, type.expression.text, resolver)?.file === contractFile,
        ),
    ) ?? false
  );
}
function concreteAppViolations(
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
  for (const file of productionFiles(serverRoot))
    for (const statement of source(file).statements.filter(ts.isClassDeclaration)) {
      const inheritedApp =
        statement.name?.text.endsWith("App") &&
        statement.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
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
      const definedApp = statement.members.some(
        (member) =>
          ts.isPropertyDeclaration(member) &&
          member.name.getText() === "contract" &&
          modifier(member, ts.SyntaxKind.StaticKeyword),
      );
      const valid = definedApp
        ? validDefinedDependencies(
            statement,
            file,
            contractFile,
            resolver,
            catalogueFeatures,
            canonicalFeatureFiles,
          ) &&
          validDefinedConcreteSurface(
            statement,
            operations,
            file,
            contractFile,
            resolver,
            canonicalFeatureFiles,
          )
        : false;
      if (!valid)
        violations.push(
          appViolation(
            file,
            "A concrete feature app exposes a different public surface from its API contract.",
            "Implement only callable API operations; keep owned services and helpers private, and expose static readonly contract, dependencies, configSchema and create metadata.",
          ),
        );
    }
  return violations;
}

function productionFiles(root: string): string[] {
  return walkFiles(
    join(root, "src"),
    (path) =>
      (path.endsWith(".ts") || path.endsWith(".tsx")) &&
      !path.includes("/__tests__/") &&
      !/(?:test|spec)\.tsx?$/.test(path),
  );
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

    if (imported === "defineFeature") {
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

  if (callee.name.text === "defineFeature") {
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

function installers(serverRoot: string): Installer[] {
  const result: Installer[] = [];
  for (const file of productionFiles(serverRoot)) {
    const contents = readFileSync(file, "utf8");
    if (!contents.includes("@langwatch/runtime-composition")) continue;

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
          `Use defineFeature("${pkg.feature}").withApp(${appName(pkg.feature ?? "")}).build() in the canonical installer.`,
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
          `Declare defineFeature("${pkg.feature}") in src/${pkg.feature}.server.ts.`,
        ),
      ];
  const app = declaration.app;
  const appDeclaration =
    app && ts.isIdentifier(app) ? importedClass(file, app.text, resolver) : void 0;
  const contractFile = join(contractRoot, "src", `${pkg.feature}.api.ts`);
  const api = exportedInterface(contractFile, apiName(pkg.feature ?? ""), resolver);
  const token = exportedVariable(contractFile, apiName(pkg.feature ?? ""), resolver);
  const operations = api ? apiOperations(api.node, resolver) : new Set<string>();
  const validApp = Boolean(
    api &&
    token &&
    appDeclaration &&
    !relative(pkg.root, appDeclaration.file).startsWith("..") &&
    usesContract(appDeclaration.node, appDeclaration.file, contractFile, resolver) &&
    validDefinedDependencies(
      appDeclaration.node,
      appDeclaration.file,
      contractFile,
      resolver,
      catalogueFeatures,
      canonicalFeatureFiles,
    ) &&
    validDefinedConcreteSurface(
      appDeclaration.node,
      operations,
      appDeclaration.file,
      contractFile,
      resolver,
      canonicalFeatureFiles,
    ),
  );
  const hasValidStages = validDefinedStages(declaration.stages);
  const valid =
    app !== void 0 && validApp && providers.length === 0 && declaration.complete && hasValidStages;
  if (!valid)
    violations.push(
      appViolation(
        file,
        "A defineFeature installer must bind exactly one valid concrete app with no legacy builder stages.",
        `Use defineFeature("${pkg.feature}").withApp(${appName(pkg.feature ?? "")}).build(); implement ${apiName(pkg.feature ?? "")} operations and expose only static API metadata and create.`,
      ),
    );
  return violations;
}

function validDefinedStages(stages: string[]): boolean {
  const hasApp = stages[0] === "withApp";
  const hasBuild = stages.at(-1) === "build";
  const hasOptionalTransports =
    stages.length === 2 || (stages.length === 3 && stages[1] === "withTransports");

  return hasApp && hasBuild && hasOptionalTransports;
}

export function lintFeatureAppContracts(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
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
        root,
        owner,
        packages,
        resolver,
        new Set(catalogue.map((item) => item.id)),
        canonicalFeatureFiles,
      ),
    );
  }

  return violations;
}

function lintFeatureOwner(
  root: string,
  owner: FeatureCatalogueEntry,
  packages: ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
  catalogueFeatures: ReadonlySet<string>,
  canonicalFeatureFiles: ReadonlyMap<string, string>,
): ArchitectureViolation[] {
  const ownerRoot = join(root, owner.root);
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
  violations.push(...contractViolations(contractRoot, owner.id, resolver));
  for (const surface of surfaces) {
    if (surface.kind === "server" || surface.kind === "web")
      violations.push(
        ...concreteAppViolations(
          surface.root,
          contractRoot,
          owner.id,
          resolver,
          catalogueFeatures,
          canonicalFeatureFiles,
        ),
      );
  }

  const declarations = installers(server.root);
  if (declarations.length === 0) {
    const installerFile = join(server.root, "src", `${owner.id}.server.ts`);
    const hidden = existsSync(installerFile);
    violations.push(
      appViolation(
        installerFile,
        hidden
          ? "The canonical installer hides its serverFeature declaration."
          : `Catalogue feature "${owner.id}" has no canonical server installer.`,
        hidden
          ? "Call the runtime-composition serverFeature factory directly in the canonical installer; do not hide registration behind wrappers or local aliases."
          : "Move the existing construction into one feature-owned serverFeature installer that provides its app, then rewire API, worker and task composition to reuse it.",
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
