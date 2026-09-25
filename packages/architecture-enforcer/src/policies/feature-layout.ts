import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  CONTRACT_ARTIFACT,
  isFeatureApiContract,
  PROCESS_MANAGER_SERVICE_PATTERN,
  RULES_PATTERN,
  SERVICE_MODULE_PATTERN,
  TEST_DIRECTORY,
} from "@langwatch/oxlint-rules/grammar/feature-layout-policy.mjs";
import ts from "typescript";

import type { ArchitectureViolation, ClassifiedPackage } from "../types.ts";
import {
  resolveRelativeModule,
  sourceFile,
  valueImports,
  walkValueImportGraph,
  type WorkspaceModuleResolver,
} from "../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";

const RULES_IMPLEMENTATION_PATH =
  /(?:^|\/)(?:services|ports|adapters|repositories|stores|projections|subscribers|processes|intents|transport)(?:\/|$)/;
const RULES_IMPLEMENTATION_KIND: Record<string, string> = {
  services: "service",
  ports: "port",
  adapters: "adapter",
  repositories: "repository",
  stores: "store",
  projections: "projection",
  subscribers: "subscriber",
  processes: "process",
  intents: "intent",
  transport: "transport",
};
const RULES_FORBIDDEN_SPECIFIER: readonly (readonly [RegExp, string])[] = [
  [/^@prisma\//, "Prisma"],
  [/^@langwatch\/prisma-client(?:\/|$)/, "Prisma"],
  [/^@langwatch\/clickhouse-client(?:\/|$)/, "ClickHouse"],
];

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function violation(file: string, message: string, allowed: string): ArchitectureViolation {
  return { policy: "feature-layout", file, message, allowed };
}

/**
 * The composition root's feature-API vocabulary: the DI token a contract
 * declares its callable API with, and the name of a feature. Everything else
 * the package exports is process wiring a contract may not reach.
 */
const FEATURE_API_VOCABULARY = new Set(["moduleApi", "ModuleApiToken", "ModuleName"]);

/** What an import of the composition root binds that a contract may not. */
function compositionBindingsBeyondFeatureApi(statement: ts.ImportDeclaration): string[] {
  const clause = statement.importClause;
  if (!clause) return [];

  if (clause.name) return ["a default import"];

  const bindings = clause.namedBindings;
  if (!bindings) return [];

  if (!ts.isNamedImports(bindings)) return ["a namespace import"];

  return bindings.elements
    .map((element) => (element.propertyName ?? element.name).text)
    .filter((name) => !FEATURE_API_VOCABULARY.has(name));
}

/** The contract's service artifacts and feature API files, tests excluded. */
function contractArtifacts(snapshot: WorkspaceSnapshot, pkg: ClassifiedPackage): string[] {
  const files = snapshot.files({
    directory: `${pkg.root}/src`,
    accept: (path) => /\.[cm]?[jt]sx?$/.test(path),
  });

  return files.filter((file) => {
    const path = workspacePath(`${pkg.root}/src`, file);
    if (TEST_DIRECTORY.test(path)) return false;

    const filename = path.slice(path.lastIndexOf("/") + 1);

    return CONTRACT_ARTIFACT.test(filename) || isFeatureApiContract(path, pkg.feature);
  });
}

/** A portable feature API may bind only the feature-API vocabulary from @langwatch/kernel. */
function kernelBindingViolations(api: string): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const statement of sourceFile({ file: api }).statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "@langwatch/kernel") continue;

    const bound = compositionBindingsBeyondFeatureApi(statement);
    if (bound.length === 0) continue;

    violations.push(
      violation(
        api,
        `A portable feature API may bind only the feature-API vocabulary from @langwatch/kernel; it binds ${bound.join(", ")}.`,
        "Import moduleApi, ModuleApiToken or ModuleName and nothing else; the rest of the runtime root is a composition boundary.",
      ),
    );
  }
  return violations;
}

function lintContract(
  snapshot: WorkspaceSnapshot,
  pkg: ClassifiedPackage,
): ArchitectureViolation[] {
  if (contractArtifacts(snapshot, pkg).length === 0) {
    return [
      violation(
        `${pkg.root}/src`,
        "A strict contract package must declare its callable feature API.",
        "Add src/<feature>.api.ts exporting the <Feature>Api interface and its moduleApi token, and export it from src/index.ts.",
      ),
    ];
  }
  const api = `${pkg.root}/src/${pkg.feature}.api.ts`;
  return existsSync(api) ? kernelBindingViolations(api) : [];
}

/** The implementation directory a resolved file lives under, package-relative. */
function rulesImplementationKind(relativePath: string): string | undefined {
  const match = relativePath.match(RULES_IMPLEMENTATION_PATH)?.[0]?.replace(/\//g, "");

  return match ? RULES_IMPLEMENTATION_KIND[match] : void 0;
}

function namedForbiddenSpecifier(specifier: string): string | undefined {
  return RULES_FORBIDDEN_SPECIFIER.find(([pattern]) => pattern.test(specifier))?.[1];
}

function withArticle(noun: string): string {
  return `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
}

/**
 * Whether `entry`'s own value-import closure stays clear of Prisma,
 * ClickHouse, and any package's services/ports/adapters/repositories —
 * the "framework-free workspace package" a rules/ import may still name.
 */
function isRulesFrameworkFree({
  entry,
  resolver,
}: {
  entry: string;
  resolver: WorkspaceModuleResolver;
}): boolean {
  return (
    walkValueImportGraph({
      roots: [entry],
      resolve: (options) => resolver.resolve(options),
      forbidden: ({ specifier, target }) => {
        const named = namedForbiddenSpecifier(specifier);
        if (named) return named;

        if (!target) return void 0;

        const owner = resolver.owningPackage({ file: target });
        if (!owner) return void 0;

        const kind = rulesImplementationKind(
          relative(owner.directory, target).split(sep).join("/"),
        );

        return kind ? withArticle(kind) : void 0;
      },
    }).seeds.size === 0
  );
}

function relativeRulesImportViolations({
  pkg,
  file,
  specifier,
  allowed,
}: {
  pkg: ClassifiedPackage;
  file: string;
  specifier: string;
  allowed: string;
}): ArchitectureViolation[] {
  const target = resolveRelativeModule({ file, specifier });
  const relativeTarget = target ? workspacePath(`${pkg.root}/src`, target) : void 0;
  if (relativeTarget?.startsWith("rules/")) return [];

  const kind = relativeTarget ? rulesImplementationKind(relativeTarget) : void 0;

  return [
    violation(
      file,
      `Rules module cannot import ${JSON.stringify(specifier)}${kind ? `, ${withArticle(kind)}` : ""}.`,
      allowed,
    ),
  ];
}

function lintRulesImports(
  pkg: ClassifiedPackage,
  file: string,
  resolver: WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  const allowed =
    "A rules/ file may import only node:*, other rules/ modules in the same package, *-contract packages, and framework-free workspace packages.";

  for (const { specifier } of valueImports({ file })) {
    if (specifier.startsWith("node:")) continue;

    if (specifier.startsWith(".")) {
      violations.push(...relativeRulesImportViolations({ pkg, file, specifier, allowed }));

      continue;
    }

    const named = namedForbiddenSpecifier(specifier);

    if (named) {
      violations.push(
        violation(
          file,
          `Rules module cannot import ${JSON.stringify(specifier)} (${named}).`,
          allowed,
        ),
      );

      continue;
    }

    const target = resolver.resolve({ specifier, file });
    if (!target) continue;

    const owner = resolver.owningPackage({ file: target });
    if (owner?.name.endsWith("-contract")) continue;

    if (isRulesFrameworkFree({ entry: target, resolver })) continue;

    violations.push(
      violation(file, `Rules module cannot import ${JSON.stringify(specifier)}.`, allowed),
    );
  }

  return violations;
}

function lintServer(snapshot: WorkspaceSnapshot, pkg: ClassifiedPackage): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  const files = snapshot.files({
    directory: `${pkg.root}/src`,
    accept: (path) => /\.[cm]?[jt]sx?$/.test(path),
  });

  let serviceCount = 0;

  for (const file of files) {
    const path = workspacePath(`${pkg.root}/src`, file);
    if (TEST_DIRECTORY.test(path)) continue;

    if (PROCESS_MANAGER_SERVICE_PATTERN.test(path)) continue;

    if (RULES_PATTERN.test(path)) {
      violations.push(...lintRulesImports(pkg, file, snapshot.resolver));
      continue;
    }

    if (SERVICE_MODULE_PATTERN.test(path)) serviceCount += 1;
  }

  if (serviceCount === 0) {
    violations.push(
      violation(
        `${pkg.root}/src/services`,
        "A strict server package must contain a subject-named service class module.",
        "Add src/services/<subject>.service.ts.",
      ),
    );
  }

  return violations;
}

const PRIVATE_SERVER_EXPORT =
  /(?:^|\/)(?:app|projections|repositories|rules|services|stores)(?:\/|$)/;
/**
 * What `src/testing.ts` may still export past `PRIVATE_SERVER_EXPORT`: a
 * double, not a real repository, store, or projection (R6, burn-down §4).
 */
const TESTING_ENTRY_DOUBLE =
  /(?:^|\/)(?:repositories|stores)\/memory(?:\/|$)|(?:^|\/)(?:memory|null|stub|fake)\.[^/]+\.(?:repository|store)\.ts$|(?:^|\/)[^/]*\.test-fakes\.ts$/;
const SOURCE_FILE_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * `export` / `import` targets from a package.json manifest field, flattened
 * across every condition. Only the first string under a key is needed —
 * every branch of a condition points at the same source file on disk.
 */
function firstManifestTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;

  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;

  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = firstManifestTarget(nested);
    if (found) return found;
  }

  return void 0;
}

function manifestTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.values(value as Record<string, unknown>).flatMap(manifestTargets);
}

/** Public entrypoints from the exports map and src/index.ts. */
function packageEntrypoints(pkg: ClassifiedPackage): string[] {
  const targets = new Set<string>(["src/index.ts"]);

  for (const target of manifestTargets(pkg.manifest.exports)) {
    const isDeclaration = target.endsWith(".d.ts");
    if (isDeclaration) continue;

    let matchesSourceExtension = false;

    for (const extension of SOURCE_FILE_EXTENSIONS) {
      if (target.endsWith(extension)) {
        matchesSourceExtension = true;
        break;
      }
    }

    if (matchesSourceExtension) {
      targets.add(target.replace(/^\.\//, ""));
    }
  }

  return [...targets].map((target) => `${pkg.root}/${target}`);
}

const packageImportsCache = new Map<string, Record<string, unknown> | undefined>();

/** Read self-referencing package aliases once per package. */
function packageImportsMap(pkg: ClassifiedPackage): Record<string, unknown> | undefined {
  if (packageImportsCache.has(pkg.manifestPath)) return packageImportsCache.get(pkg.manifestPath);

  let map: Record<string, unknown> | undefined;

  try {
    const raw = JSON.parse(readFileSync(pkg.manifestPath, "utf8")) as { imports?: unknown };

    if (raw.imports && typeof raw.imports === "object" && !Array.isArray(raw.imports)) {
      map = raw.imports as Record<string, unknown>;
    }
  } catch {
    map = void 0;
  }

  packageImportsCache.set(pkg.manifestPath, map);

  return map;
}

function resolveImportsAlias(specifier: string, pkg: ClassifiedPackage): string | undefined {
  const importsMap = packageImportsMap(pkg);
  if (!importsMap) return void 0;

  for (const [key, value] of Object.entries(importsMap)) {
    const targetPattern = firstManifestTarget(value);
    if (!targetPattern) continue;

    if (key.endsWith("*")) {
      const prefix = key.slice(0, -1);
      if (!specifier.startsWith(prefix)) continue;

      const captured = specifier.slice(prefix.length);

      return join(pkg.root, targetPattern.replace("*", captured));
    }

    if (key === specifier) return join(pkg.root, targetPattern);
  }

  return void 0;
}

/** Resolve local aliases; bare package imports cannot name private directories. */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  pkg: ClassifiedPackage,
): string | undefined {
  let base: string | undefined;

  if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith("#")) {
    base = resolveImportsAlias(specifier, pkg);
  }

  if (!base) return void 0;

  for (const candidate of [
    base,
    ...SOURCE_FILE_EXTENSIONS.map((ext) => `${base}${ext}`),
    join(base, "index.ts"),
  ]) {
    if (!existsSync(candidate)) continue;

    const stat = statSync(candidate);
    if (stat.isFile()) return candidate;
  }

  return void 0;
}

function isPrivateServerPath(
  pkg: ClassifiedPackage,
  file: string,
  allowTestingDoubles = false,
): boolean {
  const relativePath = workspacePath(`${pkg.root}/src`, file);
  if (!PRIVATE_SERVER_EXPORT.test(relativePath)) return false;

  if (allowTestingDoubles && TESTING_ENTRY_DOUBLE.test(relativePath)) return false;

  return true;
}

function exportName(element: ts.ExportSpecifier): string {
  return element.propertyName?.text ?? element.name.text;
}

function declaresValue(statement: ts.Statement, name: string): boolean {
  if (ts.isClassDeclaration(statement) && statement.name?.text === name) return true;

  if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return true;

  if (ts.isEnumDeclaration(statement) && statement.name.text === name) return true;

  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
    );
  }

  return false;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

function isExportedValueDeclaration(statement: ts.Statement): boolean {
  if (ts.isClassDeclaration(statement)) return hasExportModifier(statement);

  if (ts.isFunctionDeclaration(statement)) return hasExportModifier(statement);

  if (ts.isVariableStatement(statement)) return hasExportModifier(statement);

  if (ts.isEnumDeclaration(statement)) return hasExportModifier(statement);

  return false;
}

function parseModule(file: string): ts.SourceFile {
  return sourceFile({ file, kind: ts.ScriptKind.TS });
}

type BindingOrigin = { file: string; name: string; via: "import" | "export" };

function namedImportOrigins({
  elements,
  name,
  target,
}: {
  elements: readonly ts.ImportSpecifier[];
  name: string;
  target: string | undefined;
}): BindingOrigin[] {
  if (!target) return [];
  return elements
    .filter((element) => !element.isTypeOnly && element.name.text === name)
    .map((element) => ({
      file: target,
      name: element.propertyName?.text ?? element.name.text,
      via: "import" as const,
    }));
}

/** Where a value import of `name` in `file` points: its default and named bindings, in order. */
function importedOrigins({
  statement,
  file,
  name,
  pkg,
}: {
  statement: ts.Statement;
  file: string;
  name: string;
  pkg: ClassifiedPackage;
}): BindingOrigin[] {
  if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) return [];
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return [];
  const clause = statement.importClause;
  if (!clause) return [];
  const specifier = statement.moduleSpecifier.text;
  const origins: BindingOrigin[] = [];

  if (clause.name?.text === name) {
    const target = resolveSpecifier(file, specifier, pkg);
    if (target) origins.push({ file: target, name: "default", via: "import" });
  }
  if (clause.namedBindings && !ts.isNamespaceImport(clause.namedBindings)) {
    const target = resolveSpecifier(file, specifier, pkg);
    origins.push(...namedImportOrigins({ elements: clause.namedBindings.elements, name, target }));
  }
  return origins;
}

/**
 * Where a value re-export of `name` from `file` points. `export * from` may
 * forward the name, so it is probed best-effort.
 */
function reExportedOrigins({
  statement,
  file,
  name,
  pkg,
}: {
  statement: ts.Statement;
  file: string;
  name: string;
  pkg: ClassifiedPackage;
}): BindingOrigin[] {
  if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) return [];
  if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
  const target = resolveSpecifier(file, statement.moduleSpecifier.text, pkg);
  if (!target) return [];

  if (!statement.exportClause) return [{ file: target, name, via: "export" }];
  if (!ts.isNamedExports(statement.exportClause)) return [];
  return statement.exportClause.elements
    .filter((element) => !element.isTypeOnly && element.name.text === name)
    .map((element) => ({ file: target, name: exportName(element), via: "export" as const }));
}

/**
 * Follows one binding (`name`, exported by `file`) back to the file that
 * actually declares it — through local declarations and
 * `import`/`export … from` chains — reporting if that file is private.
 */
function resolveBindingOrigin({
  file,
  name,
  pkg,
  visited,
  allowTestingDoubles = false,
}: {
  file: string;
  name: string;
  pkg: ClassifiedPackage;
  visited: Set<string>;
  allowTestingDoubles?: boolean;
}): boolean {
  const key = `${file}::${name}`;
  if (visited.has(key)) return false;

  visited.add(key);
  if (!existsSync(file)) return false;

  const sourceFile = parseModule(file);

  for (const statement of sourceFile.statements) {
    if (declaresValue(statement, name)) {
      return isPrivateServerPath(pkg, file, allowTestingDoubles);
    }
  }

  const followed = sourceFile.statements.flatMap((statement) => [
    ...importedOrigins({ statement, file, name, pkg }),
    ...reExportedOrigins({ statement, file, name, pkg }),
  ]);
  const imports = followed.filter((origin) => origin.via === "import");
  const exports = followed.filter((origin) => origin.via === "export");

  return [...imports, ...exports].some((origin) =>
    resolveBindingOrigin({
      file: origin.file,
      name: origin.name,
      pkg,
      visited,
      allowTestingDoubles,
    }),
  );
}

/**
 * The named-export elements from `file` (via `export *`, named re-exports, or
 * local declarations) whose binding is declared under a feature server's
 * private directories.
 */
function privateNamedExports({
  origin,
  clause,
  pkg,
  allowTestingDoubles,
}: {
  origin: string;
  clause: ts.NamedExports;
  pkg: ClassifiedPackage;
  allowTestingDoubles: boolean;
}): ts.ExportSpecifier[] {
  return clause.elements.filter(
    (element) =>
      !element.isTypeOnly &&
      resolveBindingOrigin({
        file: origin,
        name: exportName(element),
        pkg,
        visited: new Set(),
        allowTestingDoubles,
      }),
  );
}

/** One statement's verdict for `fileExposesPrivateValue`. */
function statementExposesPrivateValue({
  statement,
  file,
  pkg,
  visited,
  allowTestingDoubles,
}: {
  statement: ts.Statement;
  file: string;
  pkg: ClassifiedPackage;
  visited: Set<string>;
  allowTestingDoubles: boolean;
}): boolean {
  if (!ts.isExportDeclaration(statement)) {
    return (
      isExportedValueDeclaration(statement) && isPrivateServerPath(pkg, file, allowTestingDoubles)
    );
  }

  if (statement.isTypeOnly) return false;

  const clause = statement.exportClause;

  if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
    const target = resolveSpecifier(file, statement.moduleSpecifier.text, pkg);
    if (!target) return false;

    if (!clause || ts.isNamespaceExport(clause)) {
      return fileExposesPrivateValue({ file: target, pkg, visited, allowTestingDoubles });
    }

    return (
      ts.isNamedExports(clause) &&
      privateNamedExports({ origin: target, clause, pkg, allowTestingDoubles }).length > 0
    );
  }

  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    privateNamedExports({ origin: file, clause, pkg, allowTestingDoubles }).length > 0
  );
}

function fileExposesPrivateValue({
  file,
  pkg,
  visited,
  allowTestingDoubles = false,
}: {
  file: string;
  pkg: ClassifiedPackage;
  visited: Set<string>;
  allowTestingDoubles?: boolean;
}): boolean {
  if (visited.has(file)) return false;

  visited.add(file);
  if (!existsSync(file)) return false;

  return parseModule(file).statements.some((statement) =>
    statementExposesPrivateValue({ statement, file, pkg, visited, allowTestingDoubles }),
  );
}

type PrivateExport = { node: ts.Node; specifier: string | undefined };

/**
 * A re-export from another module. Tested against the resolved file (which
 * carries its .ts extension, so `fake.<x>.repository.ts` allowances match),
 * else against the raw specifier, so an unresolvable private path is caught.
 */
function privateReExports({
  statement,
  specifierText,
  file,
  pkg,
  allowTestingDoubles,
}: {
  statement: ts.ExportDeclaration;
  specifierText: string;
  file: string;
  pkg: ClassifiedPackage;
  allowTestingDoubles: boolean;
}): PrivateExport[] {
  const target = resolveSpecifier(file, specifierText, pkg);
  const originPath = target ? workspacePath(`${pkg.root}/src`, target) : specifierText;
  const isDouble = allowTestingDoubles && TESTING_ENTRY_DOUBLE.test(originPath);
  if (PRIVATE_SERVER_EXPORT.test(originPath) && !isDouble) {
    return [{ node: statement, specifier: specifierText }];
  }
  if (!target) return [];

  if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
    const exposes = fileExposesPrivateValue({
      file: target,
      pkg,
      visited: new Set(),
      allowTestingDoubles,
    });
    return exposes ? [{ node: statement, specifier: specifierText }] : [];
  }
  return privateNamedExports({
    origin: target,
    clause: statement.exportClause,
    pkg,
    allowTestingDoubles,
  }).map((element) => ({ node: element, specifier: specifierText }));
}

function privateExports({
  statement,
  file,
  pkg,
  allowTestingDoubles,
}: {
  statement: ts.ExportDeclaration;
  file: string;
  pkg: ClassifiedPackage;
  allowTestingDoubles: boolean;
}): PrivateExport[] {
  if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
    const specifierText = statement.moduleSpecifier.text;
    return privateReExports({ statement, specifierText, file, pkg, allowTestingDoubles });
  }
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return [];
  return privateNamedExports({
    origin: file,
    clause: statement.exportClause,
    pkg,
    allowTestingDoubles,
  }).map((element) => ({ node: element, specifier: exportName(element) }));
}

function lintPrivateServerExportsForEntry(
  pkg: ClassifiedPackage,
  file: string,
): ArchitectureViolation[] {
  if (!existsSync(file)) return [];

  // R6: `src/testing.ts` is a test-only entrypoint. It may still export a
  // double (a memory/null/stub/fake repository or store, or a
  // `*.test-fakes.ts` module) — never a real repository, store, or
  // projection, which stays as private from `testing.ts` as from `index.ts`.
  const allowTestingDoubles = basename(file) === "testing.ts";
  const sourceFile = parseModule(file);
  const violations: ArchitectureViolation[] = [];

  const add = (node: ts.Node, specifier?: string): void => {
    violations.push({
      policy: "private-runtime-export",
      file,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      specifier,
      message:
        "A feature server root cannot expose a service, repository, store, projection, app, or rule implementation.",
      allowed:
        "Export the feature installer (<feature>Server), its transport declarations, its Infrastructure type, and contract-facing types; keep everything else private to the feature server.",
    });
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    for (const exposed of privateExports({ statement, file, pkg, allowTestingDoubles })) {
      add(exposed.node, exposed.specifier);
    }
  }

  return violations;
}

function lintPrivateServerExports(pkg: ClassifiedPackage): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const file of packageEntrypoints(pkg)) {
    violations.push(...lintPrivateServerExportsForEntry(pkg, file));
  }

  return violations;
}

/** Contract and server layout, and private-runtime-export. */
export function lintFeatureLayouts(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const pkg of snapshot.packages) {
    if (pkg.kind === "contract") violations.push(...lintContract(snapshot, pkg));

    if (pkg.kind === "process") {
      violations.push(...lintServer(snapshot, pkg));
      violations.push(...lintPrivateServerExports(pkg));
    }
  }

  return violations;
}
