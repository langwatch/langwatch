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
 * §3.4's kit law, encoded (ARCHITECTURE.md, ruled 2026-09-18): the checks below read
 * `snapshot.resolver` directly, since `discoverClassifiedPackages` does not yet know the
 * `process`/`browser`/`browser-kit` directory names (§16).
 */

type ModuleRole = "contract" | "process" | "browser" | "browser-kit";

type ModulePackage = {
  role: ModuleRole;
  /** `modules/<name>` or `enterprise/modules/<name>`, workspace-relative. */
  moduleRoot: string;
  name: string;
  directory: string;
  manifestPath: string;
};

const MODULE_PACKAGE_DIRECTORY =
  /^((?:enterprise\/)?modules\/[^/]+)\/(contract|process|browser|browser-kit)$/;

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
    message: `${JSON.stringify(target.name)} is a closed browser package (ARCHITECTURE.md §3.4 kit law 1); only apps/ui may reach it.`,
    allowed: `Move the shared thing into ${target.moduleRoot.split("/").pop()}-browser-kit and depend on that instead.`,
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
  uiRoot,
}: {
  file: string;
  browserPackages: readonly ModulePackage[];
  uiRoot: string;
}): ArchitectureViolation[] {
  if (isWithin(uiRoot, file)) return [];

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
 * Kit law 1: "Nothing else imports [a module's browser package], ever" — every static
 * form (`import`, side-effect `import`, `export ... from`, dynamic and type-position
 * `import()`), across the whole workspace. `apps/ui` is exempt: it installs browser halves.
 */
export function lintBrowserPackageClosure(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, resolver, files } = snapshot;
  const modulePackages = discoverModulePackages(resolver, root);
  const browserPackages = modulePackages.filter((pkg) => pkg.role === "browser");
  if (browserPackages.length === 0) return [];

  const uiRoot = join(root, "apps", "ui");
  const violations: ArchitectureViolation[] = [];

  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = join(root, ...sourceRoot.split("/"));

    for (const file of files({ directory, accept: isSourceFile })) {
      violations.push(...fileClosureViolations({ file, browserPackages, uiRoot }));
    }
  }

  return violations;
}

/**
 * The manifest half of kit law 1: a dependency edge onto another module's browser package
 * is a violation whether or not any source file uses it (§3.4 rule 4) — the manifest line
 * itself is cheaper and harder to evade than a source sweep.
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

      violations.push(
        closureViolation({
          policy: "browser-package-manifest-closure",
          file: pkg.manifestPath,
          specifier: name,
          target,
        }),
      );
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
        allowed:
          "Delete the entry, or move the shared thing into this module's browser-kit and export it there.",
      });
    }
  }

  return violations;
}

/**
 * Kit law rule 4: "A kit is a package, not a subpath" — every export folds through the
 * package's own single `.` entry, so a cross-module edge always reads as a manifest line.
 */
export function lintBrowserKitExports(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const modulePackages = discoverModulePackages(snapshot.resolver, snapshot.root);
  const violations: ArchitectureViolation[] = [];

  for (const pkg of modulePackages) {
    if (pkg.role !== "browser-kit") continue;

    const manifest = readManifestFile(pkg.manifestPath);

    for (const key of exportKeys(manifest.exports)) {
      if (key === ".") continue;

      violations.push({
        policy: "browser-kit-exports",
        file: pkg.manifestPath,
        specifier: key,
        message: `A kit's exports map declares only "." (ARCHITECTURE.md §3.4 kit law 4); ${JSON.stringify(key)} is a subpath a kit may not open.`,
        allowed: 'Fold every export through the single "." entry.',
      });
    }
  }

  return violations;
}

/**
 * Kit law rule 2: a kit is a leaf — it may depend on any module's contract, the Design
 * System, and `browser-host`, nothing else in the `@langwatch/*` family. Vendor deps
 * (React, Chakra, icons) are what rendering needs and are not what this rule guards.
 */
export function lintBrowserKitDependencies(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const modulePackages = discoverModulePackages(snapshot.resolver, snapshot.root);
  const violations: ArchitectureViolation[] = [];

  for (const pkg of modulePackages) {
    if (pkg.role !== "browser-kit") continue;

    const manifest = readManifestFile(pkg.manifestPath);
    const dependencies = manifestDependencies(manifest);

    for (const name of Object.keys(dependencies)) {
      if (!name.startsWith("@langwatch/")) continue;

      const allowed =
        name.endsWith("-contract") ||
        name === "@langwatch/design-system" ||
        name === "@langwatch/browser-host";

      if (allowed) continue;

      violations.push({
        policy: "browser-kit-dependencies",
        file: pkg.manifestPath,
        specifier: name,
        message: `A kit may depend only on contracts, the Design System, and browser-host (ARCHITECTURE.md §3.4 kit law 2); ${JSON.stringify(name)} is none of those.`,
        allowed: "Depend on the owning module's contract instead, or drop the dependency.",
      });
    }
  }

  return violations;
}
