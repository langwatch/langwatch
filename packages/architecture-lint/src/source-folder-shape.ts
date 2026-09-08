import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "./baseline.ts";
import { PACKAGE_SOURCE_ROOTS, walkFiles } from "./workspace/layout.ts";
import { sourceText, valueImports } from "./workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
import type { ArchitectureViolation } from "./types.ts";

/**
 * A folder is one concept, a file is one part of it that reads alone. Two ways a tree
 * stops being that: a folder past what a reader can hold, and a file so small only one
 * neighbour reads it. Messages are the instruction the author should have followed.
 */

const BASELINE_FILE = "source-folder-shape-baseline.json";

/** Source files a folder may hold before it is a filing cabinet rather than a module. */
export const FOLDER_BUDGET = 12;

/** Below this many lines a file is suspected of being a paragraph of another file. */
export const FRAGMENT_FLOOR = 20;

/**
 * Files the feature grammar requires one of per feature: the installer (`<f>.server.ts`)
 * and the process mount that binds a transport declaration. Their size is set by the
 * runtime's signature, not by the author.
 */
const GRAMMAR_REQUIRED_SUFFIXES = [".server.ts", ".mount.ts"];

export const SOURCE_FOLDER_SHAPE_KINDS = ["crowded-folder", "fragment-file"] as const;

export type SourceFolderShapeKind = (typeof SOURCE_FOLDER_SHAPE_KINDS)[number];

export type SourceFolderShapeFinding = {
  kind: SourceFolderShapeKind;
  /** Repository-relative path of the folder or the file. */
  path: string;
  message: string;
  allowed: string;
};

const SKIPPED_DIRECTORIES = new Set(["__tests__", "__mocks__", "generated", "test-utils"]);

function isSourceFile(path: string): boolean {
  const name = basename(path);
  if (!/\.tsx?$/.test(name)) return false;

  if (/\.(?:test|spec)\.tsx?$/.test(name)) return false;

  if (name.endsWith(".d.ts")) return false;

  if (/\.generated\.tsx?$/.test(name)) return false;

  return !path.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

/** Only files beneath a `src` directory are a package's own source. */
function isUnderSrc(path: string): boolean {
  return path.split("/").includes("src");
}

function sourceFiles(root: string): string[] {
  return PACKAGE_SOURCE_ROOTS.flatMap((scanned) =>
    walkFiles(join(root, scanned), (path) => isSourceFile(path) && isUnderSrc(path)),
  );
}

function resolveImport(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  const base = resolve(dirname(from), specifier);

  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.jsx$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];

  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

/**
 * Who reads each source file, by relative value import only; package-name
 * imports are entries. `import type` is erased at build, so a types file read
 * only by types is nobody's paragraph and the graph, not a regex, says so.
 */
function importersOf(files: readonly string[]): Map<string, Set<string>> {
  const known = new Set(files);
  const importers = new Map<string, Set<string>>();

  for (const file of files) {
    for (const { specifier, dynamic } of valueImports({ file })) {
      // A lazily loaded screen is a route split, not a paragraph of its index.
      if (dynamic || !specifier.startsWith(".")) continue;

      const target = resolveImport(file, specifier, known);
      if (!target || target === file) continue;

      const set = importers.get(target) ?? new Set<string>();
      set.add(file);
      importers.set(target, set);
    }
  }

  return importers;
}

function lineCount(file: string): number {
  return sourceText({ file })
    .split("\n")
    .filter((line) => line.trim() !== "").length;
}

function crowdedFolderFinding(directory: string, count: number): SourceFolderShapeFinding {
  return {
    kind: "crowded-folder",
    path: directory,
    message:
      `\`${directory}\` holds ${count} source files; a folder is one concept, and past ` +
      `${FOLDER_BUDGET} files a reader stops seeing it. Before adding a file here, name the file ` +
      `that already owns this noun and put the code there.`,
    allowed:
      "If no file owns it, the folder holds two concepts: split the folder, not the file. " +
      "Fold files that share a noun into one module; a file earns its own name when it can be read alone.",
  };
}

function fragmentFileFinding(
  file: string,
  lines: number,
  readers: readonly string[],
): SourceFolderShapeFinding {
  const onlyBarrels = readers.every((reader) => basename(reader).startsWith("index."));

  const reader =
    readers.length === 1
      ? `only \`${basename(readers[0]!)}\` reads it`
      : "only its neighbours read it";

  return {
    kind: "fragment-file",
    path: file,
    message: onlyBarrels
      ? `\`${basename(file)}\` is ${lines} lines and exists only to be re-exported by the folder's ` +
        `index; nothing in this folder reads it, so it has no home here.`
      : `\`${basename(file)}\` is ${lines} lines and ${reader}, all in the same folder, so it is a ` +
        `paragraph of that file, not a module.`,
    allowed: onlyBarrels
      ? "Put the code in the file that owns its noun and export it from there, or delete it if no " +
        "other package uses the export. A barrel does not make a file a module."
      : "Move the code into the file that reads it and delete this one. A file earns its own name " +
        "when it can be read alone or when a second folder needs it.",
  };
}

export function collectSourceFolderShapeFindings(root: string): SourceFolderShapeFinding[] {
  const files = sourceFiles(root);
  const findings: SourceFolderShapeFinding[] = [];

  const byDirectory = new Map<string, string[]>();

  for (const file of files) {
    const directory = dirname(file);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), file]);
  }

  for (const [directory, members] of byDirectory) {
    if (members.length > FOLDER_BUDGET) {
      findings.push(crowdedFolderFinding(relative(root, directory), members.length));
    }
  }

  const importers = importersOf(files);

  for (const file of files) {
    const isBarrel = basename(file).startsWith("index.");
    if (isBarrel) continue;

    const grammarRequired = GRAMMAR_REQUIRED_SUFFIXES.some((suffix) => file.endsWith(suffix));
    if (grammarRequired) continue;

    const readers = [...(importers.get(file) ?? [])];
    if (readers.length === 0) continue;

    const folder = dirname(file);
    const readOnlyByNeighbours = readers.every((reader) => dirname(reader) === folder);
    if (!readOnlyByNeighbours) continue;

    const lines = lineCount(file);
    if (lines >= FRAGMENT_FLOOR) continue;

    findings.push(fragmentFileFinding(relative(root, file), lines, readers));
  }

  return findings.sort(comparePathThenKind);
}

/** Report order: a reader walks the tree by path, and a folder before its files. */
function comparePathThenKind(a: SourceFolderShapeFinding, b: SourceFolderShapeFinding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;

  if (a.kind === b.kind) return 0;

  return a.kind < b.kind ? -1 : 1;
}

/** The key of a source-folder-shape row: `<kind>|<path>`. */
function entryKey(entry: { kind: SourceFolderShapeKind; path: string }): string {
  return `${entry.kind}|${entry.path}`;
}

export const SOURCE_FOLDER_SHAPE_BASELINE: BaselinePolicy = {
  id: "source-folder-shape",
  file: BASELINE_FILE,
  label: "Source folder shape baseline",
  keyRule: "A key is `<kind>|<path>`, kind one of crowded-folder, fragment-file.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Source folder shape baseline entry ${entry.key.split("|").join(" ")} no longer matches anything and must be removed.`,
  }),
};

export function collectSourceFolderShapeBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectSourceFolderShapeFindings(root).map(entryKey);

  return collectBaseline({ policy: SOURCE_FOLDER_SHAPE_BASELINE, found, previous });
}

function baselineFile(root: string): string {
  return baselinePath({ root, policy: SOURCE_FOLDER_SHAPE_BASELINE });
}

export function lintSourceFolderShape(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const file = baselineFile(root);
  const baseline = readBaseline({ policy: SOURCE_FOLDER_SHAPE_BASELINE, file });
  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: SOURCE_FOLDER_SHAPE_BASELINE, file }),
  ];

  const findings = collectSourceFolderShapeFindings(root);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map(entryKey));

  for (const finding of findings) {
    if (baselined.has(entryKey(finding))) continue;

    violations.push({
      policy: "source-folder-shape",
      file: join(root, finding.path),
      message: finding.message,
      allowed: finding.allowed,
    });
  }

  violations.push(
    ...staleRows({
      entries: baseline.entries,
      found,
      policy: SOURCE_FOLDER_SHAPE_BASELINE,
      file,
    }),
  );

  return violations;
}
