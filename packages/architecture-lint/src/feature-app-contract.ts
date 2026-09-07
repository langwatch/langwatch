import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
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

type Declaration = { file: string; node: ts.ClassDeclaration };

function reexportedClass(
  file: string,
  statement: ts.ExportDeclaration,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited: Set<string>,
): Declaration | undefined {
  const specifier = statement.moduleSpecifier;
  if (!specifier || !ts.isStringLiteral(specifier)) return void 0;

  const target = resolver.resolve({ file, specifier: specifier.text });
  if (!target) return void 0;

  if (!statement.exportClause) return exportedClass(target, name, resolver, visited);

  if (!ts.isNamedExports(statement.exportClause)) return void 0;

  const element = statement.exportClause.elements.find(
    (item) => item.name.text === name && !item.isTypeOnly,
  );
  if (!element) return void 0;

  return exportedClass(target, (element.propertyName ?? element.name).text, resolver, visited);
}

function exportedClass(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
  visited = new Set<string>(),
): Declaration | undefined {
  const key = `${file}:${name}`;
  const unavailable = visited.has(key) || !existsSync(file);
  if (unavailable) return void 0;

  visited.add(key);
  for (const statement of source(file).statements) {
    const matchingClass = ts.isClassDeclaration(statement) && statement.name?.text === name;
    if (matchingClass && modifier(statement, ts.SyntaxKind.ExportKeyword))
      return { file, node: statement };

    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;

    const found = reexportedClass(file, statement, name, resolver, visited);
    if (found) return found;
  }

  return void 0;
}

function importedClass(
  file: string,
  name: string,
  resolver: WorkspaceModuleResolver,
): Declaration | undefined {
  for (const statement of source(file).statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    const item = bindings.elements.find((element) => element.name.text === name);
    if (!item) continue;

    const target = resolver.resolve({ file, specifier: statement.moduleSpecifier.text });
    if (target) return exportedClass(target, (item.propertyName ?? item.name).text, resolver);
  }

  return exportedClass(file, name, resolver);
}

function appName(feature: string): string {
  return `${feature
    .split("-")
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join("")}App`;
}

function appViolation(file: string, message: string, allowed: string): ArchitectureViolation {
  return {
    policy: "feature-app-contract",
    file,
    message,
    allowed: `${allowed} See dev/docs/adr/133-composition-spec.md.`,
  };
}

function isOwnService(
  type: ts.TypeNode | undefined,
  file: string,
  contractRoot: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  if (!type || !ts.isTypeReferenceNode(type)) return false;

  const simple = ts.isIdentifier(type.typeName) && !type.typeArguments?.length;
  if (!simple) return false;

  const service = importedClass(file, type.typeName.text, resolver);
  if (!service) return false;

  const local = !relative(contractRoot, service.file).startsWith("..");
  const named = service.file.endsWith(".service.ts") && service.node.name?.text.endsWith("Service");

  return Boolean(local && named && modifier(service.node, ts.SyntaxKind.AbstractKeyword));
}

function hidden(member: ts.Node & { name?: ts.Node }): boolean {
  const restricted =
    modifier(member, ts.SyntaxKind.PrivateKeyword) ||
    modifier(member, ts.SyntaxKind.ProtectedKeyword);

  return restricted || Boolean(member.name && ts.isPrivateIdentifier(member.name));
}

function validContractMember(
  member: ts.ClassElement,
  file: string,
  contractRoot: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  if (!ts.isPropertyDeclaration(member)) return false;

  const exposed = !hidden(member) && !modifier(member, ts.SyntaxKind.StaticKeyword);
  const required = !member.questionToken && !member.initializer;
  const abstractReadonly =
    modifier(member, ts.SyntaxKind.AbstractKeyword) &&
    modifier(member, ts.SyntaxKind.ReadonlyKeyword);
  const shape = exposed && required && abstractReadonly;

  return shape && isOwnService(member.type, file, contractRoot, resolver);
}

function contractViolations(
  contractRoot: string,
  feature: string,
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const file = join(contractRoot, "src", `${feature}.app.ts`);
  const name = appName(feature);
  const add = (message: string, allowed: string) => appViolation(file, message, allowed);
  if (!existsSync(file)) {
    return [
      add(
        "Every catalogue feature requires its canonical app contract.",
        `Add src/${feature}.app.ts exporting abstract ${name}, then export it from src/index.ts.`,
      ),
    ];
  }

  const violations: ArchitectureViolation[] = [];
  const modules = walkFiles(
    join(contractRoot, "src"),
    (path) => path.endsWith(".app.ts") && !path.includes("/__tests__/"),
  );
  if (modules.length !== 1) {
    violations.push(
      add(
        "A feature contract has more than one app module.",
        `Keep only src/${feature}.app.ts as the feature's public app.`,
      ),
    );
  }

  const classes = source(file).statements.filter(ts.isClassDeclaration);
  const app = classes.find((item) => item.name?.text === name);
  const abstractExport =
    app &&
    modifier(app, ts.SyntaxKind.AbstractKeyword) &&
    modifier(app, ts.SyntaxKind.ExportKeyword);
  const validClass = classes.length === 1 && abstractExport && !app?.heritageClauses?.length;
  if (!app || !validClass) {
    violations.push(
      add(
        "A feature app must declare one exported abstract app class without inheritance.",
        `Export abstract class ${name} with readonly properties for its own service contracts.`,
      ),
    );

    return violations;
  }

  if (app.members.length === 0) {
    violations.push(
      add(
        "A feature app exposes no service.",
        "Expose the existing service through an abstract readonly property; do not invent a service solely for registration.",
      ),
    );
  }

  for (const member of app.members) {
    if (!validContractMember(member, file, contractRoot, resolver)) {
      violations.push(
        add(
          "A feature app member is not an abstract readonly service owned by this feature.",
          "Expose complete local abstract service contracts as required readonly properties; keep methods, callbacks, infrastructure and foreign apps outside the app contract.",
        ),
      );
    }
  }

  const exported = exportedClass(join(contractRoot, "src/index.ts"), name, resolver);
  if (exported?.file !== file) {
    violations.push(
      add(
        "The canonical feature app is not value-exported from the contract root.",
        `Export { ${name} } from "./${feature}.app" in src/index.ts.`,
      ),
    );
  }

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

function validConcreteSurface(app: ts.ClassDeclaration, serviceNames: Set<string>): boolean {
  const provided = new Set<string>();
  for (const member of publicMembers(app)) {
    const property = ts.isPropertyDeclaration(member) || ts.isParameter(member);
    if (property) {
      const name = member.name.getText();
      const required = !member.questionToken && !modifier(member, ts.SyntaxKind.StaticKeyword);
      const readonly = modifier(member, ts.SyntaxKind.ReadonlyKeyword);
      const valid = serviceNames.has(name) && required && readonly;
      if (!valid) return false;

      provided.add(name);
      continue;
    }

    const factory =
      ts.isMethodDeclaration(member) &&
      modifier(member, ts.SyntaxKind.StaticKeyword) &&
      member.name.getText() === "create";
    if (!factory) return false;
  }

  return [...serviceNames].every((name) => provided.has(name));
}

function validDefinedConcreteSurface(
  app: ts.ClassDeclaration,
  serviceNames: Set<string>,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  const provided = new Set<string>();
  const metadata = new Set(["contract", "dependencies", "configSchema"]);
  for (const member of publicMembers(app)) {
    const isProperty = ts.isPropertyDeclaration(member) || ts.isParameter(member);
    if (isProperty) {
      const valid = validDefinedProperty(
        member,
        metadata,
        serviceNames,
        file,
        contractFile,
        resolver,
      );
      if (!valid.ok) return false;

      if (valid.serviceName) {
        provided.add(valid.serviceName);
      }

      continue;
    }

    if (!isStaticCreate(member)) return false;
  }

  return [...serviceNames].every((name) => provided.has(name));
}

function isStaticCreate(member: ts.ClassElement): boolean {
  return (
    ts.isMethodDeclaration(member) &&
    modifier(member, ts.SyntaxKind.StaticKeyword) &&
    member.name.getText() === "create"
  );
}

function validDefinedProperty(
  member: ts.PropertyDeclaration | ts.ParameterDeclaration,
  metadata: Set<string>,
  serviceNames: Set<string>,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
): { ok: boolean; serviceName?: string } {
  const name = member.name.getText();
  const isStatic = modifier(member, ts.SyntaxKind.StaticKeyword);
  const isReadonly = modifier(member, ts.SyntaxKind.ReadonlyKeyword);
  if (isStatic) {
    const validMetadata = metadata.has(name) && isReadonly && !ts.isParameter(member);
    if (!validMetadata) return { ok: false };

    if (name !== "contract") return { ok: true };

    const initializer = ts.isPropertyDeclaration(member) ? member.initializer : void 0;
    const contractImport =
      initializer && ts.isIdentifier(initializer)
        ? importedClass(file, initializer.text, resolver)
        : void 0;
    const referencesContract = Boolean(
      initializer && ts.isIdentifier(initializer) && contractImport?.file === contractFile,
    );

    return {
      ok: referencesContract,
    };
  }

  const validService = serviceNames.has(name) && !member.questionToken && isReadonly;
  if (validService) return { ok: true, serviceName: name };

  return { ok: false };
}

function usesContract(
  app: ts.ClassDeclaration,
  file: string,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  return (
    app.heritageClauses?.some(
      (clause) =>
        (clause.token === ts.SyntaxKind.ExtendsKeyword ||
          clause.token === ts.SyntaxKind.ImplementsKeyword) &&
        clause.types.some(
          (type) =>
            ts.isIdentifier(type.expression) &&
            importedClass(file, type.expression.text, resolver)?.file === contractFile,
        ),
    ) ?? false
  );
}

function concreteAppViolations(
  serverRoot: string,
  contractRoot: string,
  feature: string,
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const contractFile = join(contractRoot, "src", `${feature}.app.ts`);
  if (!existsSync(contractFile)) return [];

  const contract = source(contractFile)
    .statements.filter(ts.isClassDeclaration)
    .find((node) => node.name?.text === appName(feature));
  if (!contract) return [];

  const serviceNames = new Set(
    contract.members.filter(ts.isPropertyDeclaration).map((member) => member.name.getText()),
  );
  const violations: ArchitectureViolation[] = [];
  for (const file of productionFiles(serverRoot)) {
    for (const statement of source(file).statements.filter(ts.isClassDeclaration)) {
      if (!usesContract(statement, file, contractFile, resolver)) continue;

      const definedApp = statement.members.some(
        (member) =>
          ts.isPropertyDeclaration(member) &&
          member.name.getText() === "contract" &&
          modifier(member, ts.SyntaxKind.StaticKeyword),
      );
      const valid = definedApp
        ? validDefinedConcreteSurface(statement, serviceNames, file, contractFile, resolver)
        : validConcreteSurface(statement, serviceNames);
      if (valid) continue;

      violations.push(
        appViolation(
          file,
          "A concrete feature app exposes a different public surface from its contract.",
          "Expose only the contract's readonly service properties; keep repositories and helpers private, and allow only static create as a public factory.",
        ),
      );
    }
  }

  return violations;
}

function productionFiles(root: string): string[] {
  const isProductionFile = (path: string) => {
    const isTypeScript = path.endsWith(".ts") || path.endsWith(".tsx");
    const isTest = path.includes("/__tests__/") || /\.(?:test|spec)\.tsx?$/.test(path);

    return isTypeScript && !isTest;
  };

  return walkFiles(join(root, "src"), isProductionFile);
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
): ArchitectureViolation[] {
  return declaration.kind === "defined"
    ? definedInstallerViolations(declaration, pkg, contractRoot, resolver)
    : legacyInstallerViolations(declaration, pkg, contractRoot, resolver);
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
  const contractFile = join(contractRoot, "src", `${pkg.feature}.app.ts`);
  const contract = readContract(contractFile, appName(pkg.feature ?? ""));
  const serviceNames = new Set(
    contract?.members.filter(ts.isPropertyDeclaration).map((member) => member.name.getText()) ?? [],
  );
  const validApp = validDefinedApp(
    appDeclaration,
    contract,
    serviceNames,
    pkg,
    contractFile,
    resolver,
  );
  const hasValidStages = validDefinedStages(declaration.stages);
  const hasValidDeclaration = app !== void 0 && appDeclaration !== void 0;
  const hasNoProviders = providers.length === 0;
  const validDeclaration = hasValidDeclaration && validApp && hasNoProviders;
  const valid = validDeclaration && declaration.complete && hasValidStages;
  if (!valid) {
    violations.push(
      appViolation(
        file,
        "A defineFeature installer must bind exactly one valid concrete app with no legacy builder stages.",
        `Use defineFeature("${pkg.feature}").withApp(${appName(pkg.feature ?? "")}Server).build(); expose only static readonly metadata, static create and readonly contract services.`,
      ),
    );
  }

  return violations;
}

function validDefinedApp(
  appDeclaration: ReturnType<typeof importedClass>,
  contract: ts.ClassDeclaration | undefined,
  serviceNames: Set<string>,
  pkg: ClassifiedPackage,
  contractFile: string,
  resolver: WorkspaceModuleResolver,
): boolean {
  const hasApp = contract !== void 0 && appDeclaration?.node !== void 0;
  if (!hasApp || appDeclaration === void 0 || contract === void 0) return false;

  const isOwned = !relative(pkg.root, appDeclaration.file).startsWith("..");

  return (
    isOwned &&
    validDefinedConcreteSurface(
      appDeclaration.node,
      serviceNames,
      appDeclaration.file,
      contractFile,
      resolver,
    )
  );
}

function validDefinedStages(stages: string[]): boolean {
  const hasApp = stages[0] === "withApp";
  const hasBuild = stages.at(-1) === "build";
  const hasOptionalTransports =
    stages.length === 2 || (stages.length === 3 && stages[1] === "withTransports");

  return hasApp && hasBuild && hasOptionalTransports;
}

function readContract(file: string, name: string): ts.ClassDeclaration | undefined {
  if (!existsSync(file)) return void 0;

  return source(file)
    .statements.filter(ts.isClassDeclaration)
    .find((node) => node.name?.text === name);
}

function legacyInstallerViolations(
  declaration: Installer,
  pkg: ClassifiedPackage,
  contractRoot: string,
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const { file, call, providers } = declaration;
  const violations = declaration.complete
    ? []
    : [
        appViolation(
          file,
          "A feature installer is split across declarations or is not built.",
          "Keep serverFeature through .build() in one declaration so its dependencies and single app provider can be audited together.",
        ),
      ];
  if (!canonicalInstaller(file, call, pkg)) {
    violations.push(
      appViolation(
        file,
        "The installer does not use its canonical feature name and location.",
        `Declare serverFeature("${pkg.feature}") in src/${pkg.feature}.server.ts.`,
      ),
    );
  }

  const provider = providers[0];
  const token = provider?.arguments[0];
  const provided =
    token && ts.isIdentifier(token) ? importedClass(file, token.text, resolver) : void 0;
  const canonicalContractFile =
    provided?.file === join(contractRoot, "src", `${pkg.feature}.app.ts`);
  const canonicalApp =
    canonicalContractFile && provided.node.name?.text === appName(pkg.feature ?? "");
  const singleProvider = providers.length === 1 && provider?.arguments.length === 1;
  if (!singleProvider || !canonicalApp) {
    violations.push(
      appViolation(
        file,
        "A feature installer must provide its own app exactly once, without a selector.",
        `Return ${appName(pkg.feature ?? "")} from setup and declare .provides(${appName(pkg.feature ?? "")}); do not register individual services or extra providers.`,
      ),
    );
  }

  return violations;
}

export function lintFeatureAppContracts(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const owner of catalogue) {
    violations.push(...lintFeatureOwner(root, owner, packages, resolver));
  }

  return violations;
}

function lintFeatureOwner(
  root: string,
  owner: FeatureCatalogueEntry,
  packages: ClassifiedPackage[],
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const ownerRoot = join(root, owner.root);
  const isEnterprise = owner.classification === "enterprise";
  const surfaces = packages.filter(
    (pkg) => pkg.feature === owner.id && pkg.enterprise === isEnterprise,
  );
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
      violations.push(...concreteAppViolations(surface.root, contractRoot, owner.id, resolver));
  }

  const server = surfaces.find((pkg) => pkg.kind === "server");
  if (!server) return violations;

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
    violations.push(...installerViolations(declaration, server, contractRoot, resolver));
  }

  return violations;
}
