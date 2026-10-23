import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * ADR-192: a module's contract or process production code may not value-import a package listed
 * only in devDependencies; the packed artifact installs none, so the boot crashes with
 * ERR_MODULE_NOT_FOUND. Browser code is bundled and out of scope. Main runs at zero.
 */

export const RUNTIME_DEV_DEPENDENCY_POLICY = "runtime-dev-dependency";

const SOURCE_FILE = /\.[cm]?tsx?$/;
const NON_PRODUCTION =
  /(?:__tests__|__fixtures__|__mocks__|\/fixtures\/|\/e2e\/|\/testing\/|\/testing\.[cm]?tsx?$|\.(?:test|spec|stories|fixture|d)\.)/;
const MODULE_ROOT = /^(?:enterprise\/)?modules\/[^/]+\/(?:contract|process)$/;

export type RuntimeDevDependencyImport = {
  file: string;
  line: number;
  packageName: string;
  /** The manifest that should list the package, relative to the repository root. */
  manifest: string;
};

/** A relative, absolute or `node:` specifier names no package. */
function namesNoPackage(specifier: string): boolean {
  if (specifier.startsWith(".")) return true;

  return specifier.startsWith("/") || specifier.startsWith("node:");
}

/** `@scope/name/sub` is `@scope/name`; `name/sub` is `name`; relative and `node:` are none. */
function packageOf(specifier: string): string | undefined {
  if (namesNoPackage(specifier)) return undefined;
  const parts = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Only a statement-level `import type` is erased: under verbatimModuleSyntax an all-inline-`type`
 * list (`import { type A } from "x"`) still emits `import {} from "x"`, which loads the package.
 */
function importSpecifier(node: ts.ImportDeclaration): ts.StringLiteralLike | undefined {
  if (node.importClause?.isTypeOnly) return undefined;

  return stringOf(node.moduleSpecifier);
}

/** As for imports: only a statement-level `export type` is erased. */
function exportSpecifier(node: ts.ExportDeclaration): ts.StringLiteralLike | undefined {
  if (node.isTypeOnly) return undefined;

  return stringOf(node.moduleSpecifier);
}

function importEqualsSpecifier(node: ts.ImportEqualsDeclaration): ts.StringLiteralLike | undefined {
  const reference = node.moduleReference;
  if (node.isTypeOnly || !ts.isExternalModuleReference(reference)) return undefined;

  return stringOf(reference.expression);
}

/** `import("x")` or `require("x")`: the loaded specifier. */
function dynamicSpecifier(node: ts.CallExpression): ts.StringLiteralLike | undefined {
  if (node.arguments.length === 0) return undefined;

  const callee = node.expression;
  const dynamic =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");

  return dynamic ? stringOf(node.arguments[0]) : undefined;
}

/** The specifier of a module reference that loads code at runtime; undefined when it is erased. */
function runtimeSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if (ts.isImportDeclaration(node)) return importSpecifier(node);
  if (ts.isExportDeclaration(node)) return exportSpecifier(node);
  if (ts.isImportEqualsDeclaration(node)) return importEqualsSpecifier(node);
  if (ts.isCallExpression(node)) return dynamicSpecifier(node);

  return undefined;
}

function stringOf(node: ts.Node | undefined): ts.StringLiteralLike | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node : undefined;
}

function shipped(manifest: ClassifiedPackage["manifest"]): ReadonlySet<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

export function collectRuntimeDevDependencyImports(
  snapshot: WorkspaceSnapshot,
): RuntimeDevDependencyImport[] {
  const { root } = snapshot;
  const toPath = (file: string): string => relative(root, file).split(sep).join("/");
  const found: RuntimeDevDependencyImport[] = [];

  for (const pkg of snapshot.packages) {
    if (pkg.kind !== "contract" && pkg.kind !== "process") continue;
    if (!MODULE_ROOT.test(toPath(pkg.root))) continue;

    const devOnly = new Set(Object.keys(pkg.manifest.devDependencies ?? {}));
    if (devOnly.size === 0) continue;
    const ships = shipped(pkg.manifest);

    const files = snapshot.files({
      directory: join(pkg.root, "src"),
      accept: (file) => SOURCE_FILE.test(file) && !NON_PRODUCTION.test(toPath(file)),
    });
    const manifest = toPath(pkg.manifestPath);
    const isDevOnly = (name: string): boolean => devOnly.has(name) && !ships.has(name);
    for (const file of files)
      found.push(...devOnlyImportsOf({ file, path: toPath(file), manifest, isDevOnly }));
  }

  return found;
}

/** Every runtime import in one file of a package `isDevOnly` says ships only as a devDependency. */
function devOnlyImportsOf({
  file,
  path,
  manifest,
  isDevOnly,
}: {
  file: string;
  path: string;
  manifest: string;
  isDevOnly: (name: string) => boolean;
}): RuntimeDevDependencyImport[] {
  const source = sourceFile({ file, parents: false });
  const found: RuntimeDevDependencyImport[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = runtimeSpecifier(node);
    const name = specifier === undefined ? undefined : packageOf(specifier.text);
    if (specifier !== undefined && name !== undefined && isDevOnly(name)) {
      found.push({
        file: path,
        line: source.getLineAndCharacterOfPosition(specifier.getStart(source)).line + 1,
        packageName: name,
        manifest,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

export function lintRuntimeDevDependency(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectRuntimeDevDependencyImports(snapshot).map((finding) => ({
    policy: RUNTIME_DEV_DEPENDENCY_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.packageName,
    message: `${finding.file} imports ${finding.packageName} as a value, but ${finding.manifest} lists it only in devDependencies; the packed artifact installs no devDependencies and the boot crashes with ERR_MODULE_NOT_FOUND.`,
    allowed: `Move ${finding.packageName} to dependencies in ${finding.manifest}, or import it with import type if only types are used.`,
  }));
}
