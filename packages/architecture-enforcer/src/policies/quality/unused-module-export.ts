import { existsSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import type ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { SOURCE_ROOTS, listFiles } from "../../workspace/layout.ts";
import {
  mentionMatcher,
  moduleImports,
  sourceFile,
  workspaceModuleResolver,
  type WorkspaceModuleResolver,
} from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  DEFAULT_NAME,
  EVERY_NAME,
  exportedNamesFrom,
  readFileReferences,
  type StaticReference,
} from "./module-references.ts";

/**
 * A name a module's server package exports that no file in the repository
 * imports. The other half of `composed-exports`, which only sees what a package
 * index publishes. README, "The dead-code guards"; ADR-137.
 */

/** A module server package's own source, core and enterprise. */
const MODULE_GROUPS = ["modules", join("enterprise", "modules")];

const SKIPPED_DIRECTORIES = new Set(["__tests__", "__mocks__", "generated", "testing"]);

export type UnusedModuleExportFinding = {
  /** Repository-relative path of the file that declares the export. */
  path: string;
  /** The exported name nothing imports. */
  name: string;
  message: string;
  allowed: string;
};

/** Code-unit order, so a report reads the same on every machine. */
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

/** Whether the path lies in a module's `process/src`, wherever the module lives. */
function isModuleServerSource(root: string, path: string): boolean {
  const parts = relative(root, path).split(sep);
  const server = parts.indexOf("process");
  if (server < 1) return false;

  return parts[server + 1] === "src";
}

/** Every file under a module's server source whose exports are checked. */
export function moduleServerSources(root: string): string[] {
  return MODULE_GROUPS.flatMap((group) =>
    listFiles({
      directory: join(root, group),
      accept: (path) => isSourceFile(path) && isModuleServerSource(root, path),
    }),
  );
}

/** Every file the repository owns, as the reader of those exports. */
function repositorySources(root: string): string[] {
  return SOURCE_ROOTS.flatMap((source) =>
    listFiles({ directory: join(root, source), accept: isSourceFile }),
  );
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

type FileReadArgs = { file: string; resolveSpecifier: ResolveSpecifier; usage: Usage };

function recordStaticReferences({
  file,
  statics,
  resolveSpecifier,
  usage,
}: FileReadArgs & { statics: readonly StaticReference[] }): void {
  for (const { specifier, names } of statics) {
    const target = targetOf({ file, specifier, resolveSpecifier });
    if (target === void 0 || target === file) continue;

    for (const name of names) record({ usage, target, name });
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

/**
 * Whether `file` could name a module server source. Each resolution path is lexical, so a
 * specifier landing under a `process` directory spells "process" itself, or names a `#`
 * subpath or a package whose directory or manifest does; the file's own path may also.
 */
function serverSourceReach(resolver: WorkspaceModuleResolver): (file: string) => boolean {
  const names = [...resolver.packages.values()]
    .filter(({ directory, main, exports }) =>
      `${directory}${JSON.stringify([main, exports])}`.includes("process"),
    )
    .map(({ name }) => name);
  const mentions = mentionMatcher({ words: ["process", "#", ...names] });

  return (file) => file.includes("process") || mentions(file);
}

/** Which names each file is read for, across the whole repository. */
type UsageGraph = { usage: Usage; exported: ReadonlyMap<string, string[]> };

/** What every file reads, from one parse each, and what each `declared` file exports. */
function usageGraph({
  files,
  declared,
  resolveSpecifier,
  mayReach,
}: {
  files: readonly string[];
  declared: ReadonlySet<string>;
  resolveSpecifier: ResolveSpecifier;
  mayReach: (file: string) => boolean;
}): UsageGraph {
  const usage: Usage = new Map();
  const exported = new Map<string, string[]>();
  for (const file of files) {
    if (!existsSync(file)) continue;

    if (!declared.has(file) && !mayReach(file)) continue;

    const read = readFileReferences({ file, declared: declared.has(file) });

    recordStaticReferences({ file, statics: read.statics, resolveSpecifier, usage });

    if (read.exported !== void 0) exported.set(file, read.exported);

    readDynamicReferences({ file, resolveSpecifier, usage });
  }

  return { usage, exported };
}

export function exportedNamesOf(file: string): string[] {
  return exportedNamesFrom(statementsOf(file));
}

function unusedNamesIn({
  file,
  read,
  exported,
}: {
  file: string;
  read?: ReadonlySet<string>;
  exported?: readonly string[];
}): string[] {
  if (isBarrel(file)) return [];

  if (isTestModule(file)) return [];

  const names = read ?? new Set<string>();
  if (names.has(EVERY_NAME)) return [];

  const config = isConfigModule(file);

  return (exported ?? exportedNamesOf(file)).filter((name) => {
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

  const moduleResolver = resolver ?? workspaceModuleResolver({ root });

  const { usage, exported } = usageGraph({
    files: repositorySources(root),
    declared: new Set(declared),
    resolveSpecifier: moduleResolver.resolve,
    mayReach: serverSourceReach(moduleResolver),
  });

  const findings = declared.flatMap((file) =>
    unusedNamesIn({ file, read: usage.get(file), exported: exported.get(file) }).map((name) =>
      finding({ path: relative(root, file), name }),
    ),
  );

  return findings.toSorted((left, right) => byKey(entryKey(left), entryKey(right)));
}

export function lintUnusedModuleExports(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, resolver } = snapshot;

  return collectUnusedModuleExportFindings({ root, resolver }).map((one) => ({
    policy: "unused-module-export",
    file: join(root, one.path),
    message: one.message,
    allowed: one.allowed,
  }));
}
