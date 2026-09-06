import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files.ts";
import {
  CONTRACT_ARTIFACT,
  PROCESS_MANAGER_SERVICE_PATTERN,
  RULES_PATTERN,
  SERVICE_MODULE_PATTERN,
  TEST_DIRECTORY,
} from "@langwatch/lint-core/grammar/feature-layout-policy.mjs";
import {
  createWorkspaceModuleResolver,
  resolveRelativeModule,
  valueImports,
  walkValueImportGraph,
  type WorkspaceModuleResolver,
} from "./module-graph.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "./types.ts";

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
  return { policy: "feature-source-layout", file, message, allowed };
}

function lintContract(pkg: ClassifiedPackage): ArchitectureViolation[] {
  const files = walkFiles(`${pkg.root}/src`, (path) => /\.[cm]?[jt]sx?$/.test(path));
  const services = files.filter((file) => {
    const path = workspacePath(`${pkg.root}/src`, file);
    if (TEST_DIRECTORY.test(path)) return false;

    return CONTRACT_ARTIFACT.test(path.slice(path.lastIndexOf("/") + 1));
  });
  if (services.length > 0) return [];

  return [
    violation(
      `${pkg.root}/src`,
      "A strict contract package must declare its service capability in a subject-named module.",
      "Add src/<subject>.service.ts and export it from src/index.ts.",
    ),
  ];
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
      const target = resolveRelativeModule({ file, specifier });
      const relativeTarget = target ? workspacePath(`${pkg.root}/src`, target) : void 0;
      if (relativeTarget?.startsWith("rules/")) continue;

      const kind = relativeTarget ? rulesImplementationKind(relativeTarget) : void 0;
      violations.push(
        violation(
          file,
          `Rules module cannot import ${JSON.stringify(specifier)}${kind ? `, ${withArticle(kind)}` : ""}.`,
          allowed,
        ),
      );
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

function lintServer(
  pkg: ClassifiedPackage,
  getResolver: () => WorkspaceModuleResolver,
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const files = walkFiles(`${pkg.root}/src`, (path) => /\.[cm]?[jt]sx?$/.test(path));
  let serviceCount = 0;

  for (const file of files) {
    const path = workspacePath(`${pkg.root}/src`, file);
    if (TEST_DIRECTORY.test(path)) continue;

    if (PROCESS_MANAGER_SERVICE_PATTERN.test(path)) continue;

    if (RULES_PATTERN.test(path)) {
      violations.push(...lintRulesImports(pkg, file, getResolver()));
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

const PRIVATE_SERVER_EXPORT = /(?:^|\/)(?:projections|repositories|stores)(?:\/|$)/;
/**
 * What `src/testing.ts` may still export past `PRIVATE_SERVER_EXPORT`: a
 * double, not a real repository, store, or projection (R6, burn-down §4).
 */
const TESTING_ENTRY_DOUBLE =
  /(?:^|\/)(?:repositories|stores)\/memory(?:\/|$)|(?:^|\/)(?:memory|null|stub|fake)\.[^/]+\.(?:repository|store)\.ts$|(?:^|\/)[^/]*\.test-fakes\.ts$/;
const SOURCE_FILE_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * `export` / `import` targets from a package.json manifest field
 * (`exports` or `imports`), flattened across every condition. A leaf may be a
 * bare string or a nested `{ types, import, default, ... }` object, and only
 * the first string found under a key is needed here — every branch of a
 * condition points at the same source file on disk.
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

/** Every entrypoint a consumer can import: the package.json `exports` map, plus `src/index.ts` always. */
function packageEntrypoints(pkg: ClassifiedPackage): string[] {
  const targets = new Set<string>(["src/index.ts"]);
  for (const target of manifestTargets(pkg.manifest.exports)) {
    if (SOURCE_FILE_EXTENSIONS.some((extension) => target.endsWith(extension))) {
      targets.add(target.replace(/^\.\//, ""));
    }
  }

  return [...targets].map((target) => `${pkg.root}/${target}`);
}

const packageImportsCache = new Map<string, Record<string, unknown> | undefined>();

/** The package's `imports` field (self-referencing aliases such as `#app/*`), read once per package. */
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

/** Resolves a relative or `#`-aliased specifier to the file it loads, or `undefined` for anything else (bare package specifiers are out of scope: they cannot name this package's own private directories). */
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
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
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

function isExportedValueDeclaration(statement: ts.Statement): boolean {
  if (
    !ts.isClassDeclaration(statement) &&
    !ts.isFunctionDeclaration(statement) &&
    !ts.isVariableStatement(statement) &&
    !ts.isEnumDeclaration(statement)
  ) {
    return false;
  }

  return (
    ts.canHaveModifiers(statement) &&
    (ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

function parseModule(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/**
 * Follows one binding (`name`, exported by `file`, one way or another) back
 * to the file that actually declares it — through local declarations,
 * `import { name } from "./elsewhere"`, and `export { name } from
 * "./elsewhere"` chains — and reports whether that file lives under a
 * feature server's private directories.
 */
function resolveBindingOrigin(
  file: string,
  name: string,
  pkg: ClassifiedPackage,
  visited: Set<string>,
  allowTestingDoubles = false,
): boolean {
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

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    if (statement.importClause?.isTypeOnly) continue;

    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const clause = statement.importClause;
    if (!clause) continue;

    if (clause.name?.text === name) {
      const target = resolveSpecifier(file, statement.moduleSpecifier.text, pkg);
      if (target && resolveBindingOrigin(target, "default", pkg, visited, allowTestingDoubles))
        return true;
    }

    if (clause.namedBindings && !ts.isNamespaceImport(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly || element.name.text !== name) continue;

        const target = resolveSpecifier(file, statement.moduleSpecifier.text, pkg);
        const imported = element.propertyName?.text ?? element.name.text;
        if (target && resolveBindingOrigin(target, imported, pkg, visited, allowTestingDoubles))
          return true;
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;

    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const target = resolveSpecifier(file, statement.moduleSpecifier.text, pkg);
    if (!target) continue;

    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly || element.name.text !== name) continue;

        if (resolveBindingOrigin(target, exportName(element), pkg, visited, allowTestingDoubles))
          return true;
      }
      // `export * from "./elsewhere"` may forward the name; best-effort probe.
    } else if (
      !statement.exportClause &&
      resolveBindingOrigin(target, name, pkg, visited, allowTestingDoubles)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Whether `file`, followed through its own exports (`export *`, named
 * re-exports, and locally declared values), ultimately exposes any value
 * declared under a feature server's private directories.
 */
function fileExposesPrivateValue(
  file: string,
  pkg: ClassifiedPackage,
  visited: Set<string>,
  allowTestingDoubles = false,
): boolean {
  if (visited.has(file)) return false;

  visited.add(file);
  if (!existsSync(file)) return false;

  const sourceFile = parseModule(file);

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;

      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveSpecifier(file, statement.moduleSpecifier.text, pkg);
        if (!target) continue;

        if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
          if (fileExposesPrivateValue(target, pkg, visited, allowTestingDoubles)) return true;
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            if (element.isTypeOnly) continue;

            if (
              resolveBindingOrigin(target, exportName(element), pkg, new Set(), allowTestingDoubles)
            )
              return true;
          }
        }
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;

          if (resolveBindingOrigin(file, exportName(element), pkg, new Set(), allowTestingDoubles))
            return true;
        }
      }
    } else if (
      isExportedValueDeclaration(statement) &&
      isPrivateServerPath(pkg, file, allowTestingDoubles)
    ) {
      return true;
    }
  }

  return false;
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
        "A feature server root cannot expose a repository, store, or projection implementation.",
      allowed:
        "Export the composition adapter and service; keep persistence and projection modules private to the feature server.",
    });
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;

    if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifierText = statement.moduleSpecifier.text;
      const target = resolveSpecifier(file, specifierText, pkg);
      // Test against the resolved file (which carries its .ts extension) when
      // it resolves; a filename-shaped allowance like `fake.<x>.repository.ts`
      // only matches with the extension present. Fall back to the raw
      // specifier when resolution fails, so an unresolvable import naming a
      // private directory is still caught.
      const originPath = target ? workspacePath(`${pkg.root}/src`, target) : specifierText;
      if (
        PRIVATE_SERVER_EXPORT.test(originPath) &&
        !(allowTestingDoubles && TESTING_ENTRY_DOUBLE.test(originPath))
      ) {
        add(statement, specifierText);
        continue;
      }

      if (!target) continue;

      if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
        if (fileExposesPrivateValue(target, pkg, new Set(), allowTestingDoubles)) {
          add(statement, specifierText);
        }
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;

          if (
            resolveBindingOrigin(target, exportName(element), pkg, new Set(), allowTestingDoubles)
          ) {
            add(element, specifierText);
          }
        }
      }

      continue;
    }

    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;

        if (resolveBindingOrigin(file, exportName(element), pkg, new Set(), allowTestingDoubles))
          add(element);
      }
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

export function lintFeatureLayouts(
  root: string,
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  // Built at most once, and only when a rules/ file is actually found — most
  // lint runs never need the workspace-wide resolver this walk requires.
  let resolver: WorkspaceModuleResolver | undefined;
  const getResolver = (): WorkspaceModuleResolver => {
    resolver ??= createWorkspaceModuleResolver({ root });

    return resolver;
  };
  for (const pkg of packages) {
    if (pkg.layoutVersion !== 0) continue;

    if (pkg.kind === "contract") violations.push(...lintContract(pkg));

    if (pkg.kind === "server") {
      violations.push(...lintServer(pkg, getResolver));
      violations.push(...lintPrivateServerExports(pkg));
    }
  }

  return violations;
}
