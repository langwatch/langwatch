import { existsSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import ts from "typescript";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "../../baseline.ts";
import { SOURCE_ROOTS, walkFiles } from "../../workspace/layout.ts";
import {
  createWorkspaceModuleResolver,
  moduleImports,
  sourceFile,
  type WorkspaceModuleResolver,
} from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation } from "../../types.ts";

/**
 * A name a module's server package exports that no file in the repository
 * imports. The other half of `composed-exports`, which only sees what a package
 * index publishes. README, "The dead-code guards"; ADR-137.
 */

const BASELINE_FILE = "unused-module-export-baseline.json";

/** A module server package's own source, core and enterprise. */
const MODULE_GROUPS = ["modules", join("enterprise", "modules")];

/** The marker a whole-module reference records in place of a member name. */
const EVERY_NAME = "*";

/** The name a default export is imported under. */
const DEFAULT_NAME = "default";

const SKIPPED_DIRECTORIES = new Set(["__tests__", "__mocks__", "generated", "testing"]);

export type UnusedModuleExportFinding = {
  /** Repository-relative path of the file that declares the export. */
  path: string;
  /** The exported name nothing imports. */
  name: string;
  message: string;
  allowed: string;
};

/** Code-unit order, the order every baseline in this package is written in. */
function byKey(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

function isSourceFile(path: string): boolean {
  const name = basename(path);
  if (!/\.tsx?$/.test(name)) return false;

  if (name.endsWith(".d.ts")) return false;

  return !/\.generated\.tsx?$/.test(name);
}

/** A test, a fixture or a testing entry: written to be read by a suite, not by the tree. */
function isTestModule(path: string): boolean {
  const name = basename(path);
  if (/\.(?:test|spec)\.tsx?$/.test(name)) return true;

  const isTestingEntry = name === "testing.ts" || name.endsWith(".testing.ts");
  if (isTestingEntry) return true;

  return path.split(sep).some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

/**
 * A barrel is the package's public surface, not a declaration site. It is still
 * read as an importer, which is what excuses everything it re-exports.
 */
function isBarrel(path: string): boolean {
  return basename(path).startsWith("index.");
}

/** A configuration module's default export is read by a tool, never by an import. */
function isConfigModule(path: string): boolean {
  return /\.config\.tsx?$/.test(basename(path));
}

/** Whether the path lies in a module's `server/src`, wherever the module lives. */
function isModuleServerSource(root: string, path: string): boolean {
  const parts = relative(root, path).split(sep);
  const server = parts.indexOf("server");
  if (server < 1) return false;

  return parts[server + 1] === "src";
}

/** Every file under a module's server source whose exports are checked. */
export function moduleServerSources(root: string): string[] {
  return MODULE_GROUPS.flatMap((group) =>
    walkFiles(join(root, group), (path) => {
      if (!isSourceFile(path)) return false;

      return isModuleServerSource(root, path);
    }),
  );
}

/** Every file the repository owns, as the reader of those exports. */
function repositorySources(root: string): string[] {
  return SOURCE_ROOTS.flatMap((source) => walkFiles(join(root, source), isSourceFile));
}

/**
 * The tree moves under a whole-repository walk: a codemod deletes a file
 * between the listing and the parse, and a file that has gone is not in the
 * tree any more.
 */
function statementsOf(file: string): readonly ts.Statement[] {
  return existsSync(file) ? sourceFile({ file }).statements : [];
}

type Usage = Map<string, Set<string>>;

function record({ usage, target, name }: { usage: Usage; target: string; name: string }): void {
  const names = usage.get(target) ?? new Set<string>();

  names.add(name);
  usage.set(target, names);
}

type ResolveSpecifier = (options: { specifier: string; file: string }) => string | undefined;

/**
 * Every form the workspace writes: a relative path, a private subpath and a
 * workspace package name, all through the one cached resolver.
 */
function targetOf({
  file,
  specifier,
  resolveSpecifier,
}: {
  file: string;
  specifier: string;
  resolveSpecifier: ResolveSpecifier;
}): string | undefined {
  if (specifier.startsWith("node:")) return void 0;

  return resolveSpecifier({ specifier, file });
}

type ModuleReference = ts.ImportDeclaration | ts.ExportDeclaration;

/** The file this declaration reads, or nothing when it reads no source of ours. */
function specifierTarget({
  statement,
  file,
  resolveSpecifier,
}: {
  statement: ModuleReference;
  file: string;
  resolveSpecifier: ResolveSpecifier;
}): string | undefined {
  const specifier = statement.moduleSpecifier;
  if (specifier === void 0) return void 0;

  if (!ts.isStringLiteralLike(specifier)) return void 0;

  const target = targetOf({ file, specifier: specifier.text, resolveSpecifier });

  return target === file ? void 0 : target;
}

/** What a clause element takes: the name at the source, not the local alias. */
function takenName(element: ts.ImportSpecifier | ts.ExportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

function readImportClause({
  clause,
  target,
  usage,
}: {
  clause: ts.ImportClause | undefined;
  target: string;
  usage: Usage;
}): void {
  if (clause === void 0) return;

  if (clause.name !== void 0) record({ usage, target, name: DEFAULT_NAME });

  const bindings = clause.namedBindings;
  if (bindings === void 0) return;

  if (ts.isNamespaceImport(bindings)) {
    record({ usage, target, name: EVERY_NAME });

    return;
  }

  for (const element of bindings.elements) {
    record({ usage, target, name: takenName(element) });
  }
}

function readExportClause({
  statement,
  target,
  usage,
}: {
  statement: ts.ExportDeclaration;
  target: string;
  usage: Usage;
}): void {
  const clause = statement.exportClause;

  if (clause === void 0) {
    record({ usage, target, name: EVERY_NAME });

    return;
  }

  if (!ts.isNamedExports(clause)) {
    record({ usage, target, name: EVERY_NAME });

    return;
  }

  for (const element of clause.elements) {
    record({ usage, target, name: takenName(element) });
  }
}

type FileReadArgs = { file: string; resolveSpecifier: ResolveSpecifier; usage: Usage };

function readStaticReferences({ file, resolveSpecifier, usage }: FileReadArgs): void {
  for (const statement of statementsOf(file)) {
    if (ts.isImportDeclaration(statement)) {
      const target = specifierTarget({ statement, file, resolveSpecifier });

      if (target !== void 0) readImportClause({ clause: statement.importClause, target, usage });

      continue;
    }

    if (!ts.isExportDeclaration(statement)) continue;

    const target = specifierTarget({ statement, file, resolveSpecifier });

    if (target !== void 0) readExportClause({ statement, target, usage });
  }
}

/** A lazily loaded module names no member, so the whole of it is read. */
function readDynamicReferences({ file, resolveSpecifier, usage }: FileReadArgs): void {
  if (!existsSync(file)) return;

  for (const entry of moduleImports({ file })) {
    if (!entry.dynamic) continue;

    const target = targetOf({ file, specifier: entry.specifier, resolveSpecifier });
    if (target === void 0) continue;

    if (target !== file) record({ usage, target, name: EVERY_NAME });
  }
}

/** Which names each file is read for, across the whole repository. */
function usageGraph({
  files,
  resolveSpecifier,
}: {
  files: readonly string[];
  resolveSpecifier: ResolveSpecifier;
}): Usage {
  const usage: Usage = new Map();

  for (const file of files) {
    readStaticReferences({ file, resolveSpecifier, usage });
    readDynamicReferences({ file, resolveSpecifier, usage });
  }

  return usage;
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];

  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
}

function isExported(statement: ts.Statement): boolean {
  if (!ts.canHaveModifiers(statement)) return false;

  const modifiers = ts.getModifiers(statement) ?? [];

  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** The name a declaration statement publishes, one statement kind at a time. */
function declaredName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text;

  if (ts.isClassDeclaration(statement)) return statement.name?.text;

  if (ts.isInterfaceDeclaration(statement)) return statement.name.text;

  if (ts.isTypeAliasDeclaration(statement)) return statement.name.text;

  if (ts.isEnumDeclaration(statement)) return statement.name.text;

  if (!ts.isModuleDeclaration(statement)) return void 0;

  return ts.isIdentifier(statement.name) ? statement.name.text : void 0;
}

/**
 * A star re-export republishes names this file never spells; there is nothing
 * here to report, and the module it names is checked itself.
 */
function reexportedNames(statement: ts.ExportDeclaration): string[] {
  const clause = statement.exportClause;
  if (clause === void 0) return [];

  if (!ts.isNamedExports(clause)) return [];

  return clause.elements.map((element) => element.name.text);
}

function exportedNamesIn(statement: ts.Statement): string[] {
  if (ts.isExportAssignment(statement)) {
    return statement.isExportEquals === true ? [] : [DEFAULT_NAME];
  }

  if (ts.isExportDeclaration(statement)) return reexportedNames(statement);

  if (!isExported(statement)) return [];

  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((one) => boundNames(one.name));
  }

  const name = declaredName(statement);

  return name === void 0 ? [] : [name];
}

/** Every name this file publishes, whatever a reader would have to write to take it. */
export function exportedNamesOf(file: string): string[] {
  const names = statementsOf(file).flatMap((statement) => exportedNamesIn(statement));

  return [...new Set(names)];
}

/** The names this file publishes that nothing reads. */
function unusedNamesIn({ file, read }: { file: string; read?: ReadonlySet<string> }): string[] {
  if (isBarrel(file)) return [];

  if (isTestModule(file)) return [];

  const names = read ?? new Set<string>();
  if (names.has(EVERY_NAME)) return [];

  const config = isConfigModule(file);

  return exportedNamesOf(file).filter((name) => {
    if (names.has(name)) return false;

    return !config || name !== DEFAULT_NAME;
  });
}

function finding({ path, name }: { path: string; name: string }): UnusedModuleExportFinding {
  return {
    path,
    name,
    message:
      `\`${basename(path)}\` exports \`${name}\` and no file in the repository imports it, ` +
      "not even the package's own index. An export nothing reads is a name the next author has " +
      "to rule out before touching this file.",
    allowed:
      "Delete the export, or drop the `export` keyword if the file uses the declaration itself. " +
      "If it is meant to be part of the package's surface, export it from `index.ts`, where " +
      "`composed-exports` can see whether anything composes it.",
  };
}

/** The key of an unused-module-export row. */
function entryKey(entry: { path: string; name: string }): string {
  return `${entry.path}|${entry.name}`;
}

export function collectUnusedModuleExportFindings({
  root,
  resolver,
}: {
  root: string;
  resolver?: WorkspaceModuleResolver;
}): UnusedModuleExportFinding[] {
  const declared = moduleServerSources(root);
  if (declared.length === 0) return [];

  const resolveSpecifier = (resolver ?? createWorkspaceModuleResolver({ root })).resolve;

  const usage = usageGraph({ files: repositorySources(root), resolveSpecifier });

  const findings = declared.flatMap((file) =>
    unusedNamesIn({ file, read: usage.get(file) }).map((name) =>
      finding({ path: relative(root, file), name }),
    ),
  );

  return findings.sort((left, right) => byKey(entryKey(left), entryKey(right)));
}

export const UNUSED_MODULE_EXPORT_BASELINE: BaselinePolicy = {
  id: "unused-module-export",
  file: BASELINE_FILE,
  label: "Unused module export baseline",
  keyRule: "A key is `<repository-relative file>|<exported name>`.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Unused module export baseline entry ${entry.key.split("|").join(" ")} no longer matches anything and must be removed.`,
  }),
};

export function collectUnusedModuleExportBaseline({
  root,
  resolver,
  previous = [],
}: {
  root: string;
  resolver?: WorkspaceModuleResolver;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectUnusedModuleExportFindings({ root, resolver }).map(entryKey);

  return collectBaseline({ policy: UNUSED_MODULE_EXPORT_BASELINE, found, previous });
}

export function lintUnusedModuleExports(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, resolver } = snapshot;
  const file = baselinePath({ root, policy: UNUSED_MODULE_EXPORT_BASELINE });
  const baseline = readBaseline({ policy: UNUSED_MODULE_EXPORT_BASELINE, file });

  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: UNUSED_MODULE_EXPORT_BASELINE, file }),
  ];

  const findings = collectUnusedModuleExportFindings({ root, resolver });
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map(entryKey));

  const unlisted = findings.filter((one) => !baselined.has(entryKey(one)));

  violations.push(
    ...unlisted.map((one) => ({
      policy: "unused-module-export",
      file: join(root, one.path),
      message: one.message,
      allowed: one.allowed,
    })),
  );

  violations.push(
    ...staleRows({ entries: baseline.entries, found, policy: UNUSED_MODULE_EXPORT_BASELINE, file }),
  );

  return violations;
}
