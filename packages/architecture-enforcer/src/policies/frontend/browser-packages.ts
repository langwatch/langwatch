import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, PackageManifest } from "../../types.ts";
import { SOURCE_ROOTS } from "../../workspace/layout.ts";
import { sourceFile, sourceText, valueImports } from "../../workspace/module-graph.ts";
import type { WorkspaceModuleResolver } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { manifestDependencies } from "../boundaries/manifests.ts";

/**
 * Browser-only packages. Used by both backend boundary guard and frontend portability check,
 * so changes propagate together. OpenTelemetry entries are deliberately narrow (only the
 * three browser-specific: `WebTracerProvider`, DOM/`window.fetch` instrumentation).
 */
export const BROWSER_ONLY_PACKAGES = [
  "react",
  "react-dom",
  "react-router",
  "react-feather",
  "lucide-react",
  "framer-motion",
  "motion",
  "@chakra-ui",
  "@ark-ui",
  "@emotion",
  "@zag-js",
  "@opentelemetry/sdk-trace-web",
  "@opentelemetry/instrumentation-document-load",
  "@opentelemetry/instrumentation-fetch",
] as const;

/** The browser-only package a specifier names, or `undefined`. */
export function browserOnlyPackage(specifier: string): string | undefined {
  return BROWSER_ONLY_PACKAGES.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

/**
 * §3.4's closed browser package, encoded: the checks below read `snapshot.resolver`
 * directly, since `discoverClassifiedPackages` does not yet know the
 * `process`/`browser` directory names (§16).
 */

type ModuleRole = "contract" | "process" | "browser";

type ModulePackage = {
  role: ModuleRole;
  /** `modules/<name>` or `enterprise/modules/<name>`, workspace-relative. */
  moduleRoot: string;
  name: string;
  directory: string;
  manifestPath: string;
};

const MODULE_PACKAGE_DIRECTORY = /^((?:enterprise\/)?modules\/[^/]+)\/(contract|process|browser)$/;

function discoverModulePackages(
  resolver: WorkspaceModuleResolver,
  root: string,
): readonly ModulePackage[] {
  const found: ModulePackage[] = [];

  for (const record of resolver.packages.values()) {
    const relativeDirectory = relative(root, record.directory).split(sep).join("/");
    const match = MODULE_PACKAGE_DIRECTORY.exec(relativeDirectory);
    if (!match) continue;

    found.push({
      role: match[2] as ModuleRole,
      moduleRoot: match[1]!,
      name: record.name,
      directory: record.directory,
      manifestPath: record.manifestPath,
    });
  }

  return found.toSorted((left, right) => left.name.localeCompare(right.name));
}

function readManifestFile(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function exportKeys(exportsValue: unknown): string[] {
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) return [];

  return Object.keys(exportsValue as Record<string, unknown>);
}

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);

  return !(
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  );
}

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

function isSourceFile(file: string): boolean {
  return SOURCE_FILE.test(file);
}

function browserPackageTarget(
  specifier: string,
  browserPackages: readonly ModulePackage[],
): ModulePackage | undefined {
  return browserPackages.find(
    (pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`),
  );
}

/** The literal specifier an `ImportTypeNode` (`import("x")`) names, or `undefined`. */
function importTypeLiteral(node: ts.Node): string | undefined {
  if (!ts.isImportTypeNode(node)) return void 0;

  if (!ts.isLiteralTypeNode(node.argument)) return void 0;

  if (!ts.isStringLiteral(node.argument.literal)) return void 0;

  return node.argument.literal.text;
}

/**
 * `typeof import("x")` parses as `ImportTypeNode`, a shape `moduleImports` does not walk —
 * and `vi.importOriginal<typeof import("x")>()` genuinely loads `x` at test time, so this
 * check cannot read that spelling as inert just because it sits in type position.
 */
function importTypeSpecifiers(file: string): { specifier: string; line: number }[] {
  const parsed = sourceFile({ file, parents: false });
  const found: { specifier: string; line: number }[] = [];

  const visit = (node: ts.Node): void => {
    const specifier = importTypeLiteral(node);

    if (specifier !== void 0) {
      found.push({
        specifier,
        line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  return found;
}

const SHARED_THING_HOME =
  "Move the shared thing out: pure domain logic into the owner's contract, shared UI into the design system, framework hooks into browser-host.";

/** Workspace-relative roots that install browser halves, with why each may reach them. */
const BROWSER_INSTALLERS = [
  { root: "apps/ui", reason: "the application installs browser halves" },
  {
    root: "packages/installed-web-modules",
    reason: "the generated installer list imports each module's ./declaration",
  },
] as const;

function closureViolation({
  policy,
  file,
  line,
  specifier,
  target,
}: {
  policy: string;
  file: string;
  line?: number;
  specifier: string;
  target: ModulePackage;
}): ArchitectureViolation {
  return {
    policy,
    file,
    line,
    specifier,
    message: `${JSON.stringify(target.name)} is a closed browser package (ARCHITECTURE.md §3.4); only the installers (apps/ui, installed-web-modules) may reach it.`,
    allowed: SHARED_THING_HOME,
  };
}

/** Every closure violation one specifier list (value imports, or type-position ones) yields. */
function specifierClosureViolations({
  file,
  specifiers,
  browserPackages,
  owner,
}: {
  file: string;
  specifiers: readonly { specifier: string; line?: number }[];
  browserPackages: readonly ModulePackage[];
  owner: ModulePackage | undefined;
}): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const entry of specifiers) {
    const target = browserPackageTarget(entry.specifier, browserPackages);
    if (!target || target === owner) continue;

    violations.push(
      closureViolation({
        policy: "browser-package-closure",
        file,
        line: entry.line,
        specifier: entry.specifier,
        target,
      }),
    );
  }

  return violations;
}

/** Every closure violation one file's imports yield, across both specifier forms. */
function fileClosureViolations({
  file,
  browserPackages,
  installerRoots,
}: {
  file: string;
  browserPackages: readonly ModulePackage[];
  installerRoots: readonly string[];
}): ArchitectureViolation[] {
  if (installerRoots.some((installer) => isWithin(installer, file))) return [];

  // Cheap reject before any parse: every browser package name contains this substring.
  if (!sourceText({ file }).includes("-browser")) return [];

  const owner = browserPackages.find((pkg) => isWithin(pkg.directory, file));

  return [
    ...specifierClosureViolations({
      file,
      specifiers: valueImports({ file }),
      browserPackages,
      owner,
    }),
    ...specifierClosureViolations({
      file,
      specifiers: importTypeSpecifiers(file),
      browserPackages,
      owner,
    }),
  ];
}

/**
 * "Nothing else imports [a module's browser package], ever" (§3.4) — every static
 * form (`import`, side-effect `import`, `export ... from`, dynamic and type-position
 * `import()`), across the whole workspace. The installers (BROWSER_INSTALLERS) are exempt.
 */
export function lintBrowserPackageClosure(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, resolver, files } = snapshot;
  const modulePackages = discoverModulePackages(resolver, root);
  const browserPackages = modulePackages.filter((pkg) => pkg.role === "browser");
  if (browserPackages.length === 0) return [];

  const installerRoots = BROWSER_INSTALLERS.map((installer) =>
    join(root, ...installer.root.split("/")),
  );
  const violations: ArchitectureViolation[] = [];

  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = join(root, ...sourceRoot.split("/"));

    for (const file of files({ directory, accept: isSourceFile })) {
      violations.push(...fileClosureViolations({ file, browserPackages, installerRoots }));
    }
  }

  return violations;
}

/**
 * The manifest half of the closure: a runtime dependency edge onto another module's browser
 * package is a violation, used or not (§3.4). A `devDependencies` edge is the type-only one
 * (Q5, Alex 2026-10-01): value imports are still refused file by file above.
 */
export function lintBrowserPackageManifestClosure(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const modulePackages = discoverModulePackages(snapshot.resolver, snapshot.root);

  const browserPackages = new Map(
    modulePackages.filter((pkg) => pkg.role === "browser").map((pkg) => [pkg.name, pkg]),
  );

  if (browserPackages.size === 0) return [];

  const violations: ArchitectureViolation[] = [];

  for (const pkg of modulePackages) {
    const manifest = readManifestFile(pkg.manifestPath);
    const dependencies = manifestDependencies(manifest);

    for (const name of Object.keys(dependencies)) {
      const target = browserPackages.get(name);
      if (!target || target.name === pkg.name) continue;

      violations.push({
        ...closureViolation({
          policy: "browser-package-manifest-closure",
          file: pkg.manifestPath,
          specifier: name,
          target,
        }),
        allowed: `Import only its types and declare ${target.name} under devDependencies, or move the shared thing out: ${SHARED_THING_HOME}`,
      });
    }
  }

  return violations;
}

/**
 * §3.4: "A browser package exports `./declaration` and nothing else" — the exports map IS
 * the enforcement, so a `./surfaces/*` or bare `.` sibling entry is the hole rule 1 fell
 * through, not a separate defect.
 */
export function lintBrowserPackageExports(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const modulePackages = discoverModulePackages(snapshot.resolver, snapshot.root);
  const violations: ArchitectureViolation[] = [];

  for (const pkg of modulePackages) {
    if (pkg.role !== "browser") continue;

    const manifest = readManifestFile(pkg.manifestPath);

    for (const key of exportKeys(manifest.exports)) {
      if (key === "./declaration") continue;

      violations.push({
        policy: "browser-package-exports",
        file: pkg.manifestPath,
        specifier: key,
        message: `A browser package's exports map declares only "./declaration" (ARCHITECTURE.md §3.4); ${JSON.stringify(key)} is a side door.`,
        allowed: `Delete the entry. ${SHARED_THING_HOME}`,
      });
    }
  }

  return violations;
}
