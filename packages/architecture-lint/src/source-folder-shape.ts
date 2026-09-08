import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { walkFiles } from "./files.ts";
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
 * Files the feature grammar requires one of per feature: the process mount that binds a
 * transport declaration. Their size is set by the runtime's signature, not by the author.
 */
const GRAMMAR_REQUIRED_SUFFIXES = [".mount.ts"];

export const SOURCE_FOLDER_SHAPE_KINDS = ["crowded-folder", "fragment-file"] as const;

export type SourceFolderShapeKind = (typeof SOURCE_FOLDER_SHAPE_KINDS)[number];

export type SourceFolderShapeFinding = {
  kind: SourceFolderShapeKind;
  /** Repository-relative path of the folder or the file. */
  path: string;
  message: string;
  allowed: string;
};

type SourceFolderShapeBaselineEntry = { kind: SourceFolderShapeKind; path: string };

const SCANNED_ROOTS = ["apps", "packages", "tools/dev-runtime"];

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
  return SCANNED_ROOTS.flatMap((scanned) =>
    walkFiles(join(root, scanned), (path) => isSourceFile(path) && isUnderSrc(path)),
  );
}

const RELATIVE_IMPORT = /from\s+["'](\.{1,2}\/[^"']+)["']/g;

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

/** Who imports each source file, by relative import only; package-name imports are entries. */
function importersOf(files: readonly string[]): Map<string, Set<string>> {
  const known = new Set(files);
  const importers = new Map<string, Set<string>>();

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const target = resolveImport(file, match[1]!, known);
      if (!target || target === file) continue;

      const set = importers.get(target) ?? new Set<string>();
      set.add(file);
      importers.set(target, set);
    }
  }

  return importers;
}

function lineCount(file: string): number {
  return readFileSync(file, "utf8")
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

  return findings.sort(compareEntries);
}

function compareEntries(
  a: SourceFolderShapeBaselineEntry,
  b: SourceFolderShapeBaselineEntry,
): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;

  if (a.kind === b.kind) return 0;

  return a.kind < b.kind ? -1 : 1;
}

function entryKey(entry: SourceFolderShapeBaselineEntry): string {
  return `${entry.kind}|${entry.path}`;
}

export function collectSourceFolderShapeBaseline(root: string): SourceFolderShapeBaselineEntry[] {
  return collectSourceFolderShapeFindings(root).map(({ kind, path }) => ({ kind, path }));
}

export function formatSourceFolderShapeBaseline(
  entries: readonly SourceFolderShapeBaselineEntry[],
): string {
  const sorted = [...entries].sort(compareEntries).map(({ kind, path }) => ({ kind, path }));

  return `${JSON.stringify({ version: 0, entries: sorted }, null, 2)}\n`;
}

const baselineSchema = z
  .object({
    version: z.literal(0),
    entries: z.array(
      z.object({ kind: z.enum(SOURCE_FOLDER_SHAPE_KINDS), path: z.string() }).strict(),
    ),
  })
  .strict();

function baselineFile(root: string): string {
  return join(root, "packages", "architecture-lint", "src", BASELINE_FILE);
}

function baselineViolation(file: string, message: string, allowed?: string): ArchitectureViolation {
  return { policy: "source-folder-shape-baseline", file, message, allowed };
}

export function readSourceFolderShapeBaselineFile(file: string): {
  exists: boolean;
  entries: SourceFolderShapeBaselineEntry[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) return { exists: false, entries: [], violations: [] };

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      exists: true,
      entries: [],
      violations: [
        baselineViolation(file, `Source folder shape baseline must be valid JSON: ${reason}`),
      ],
    };
  }

  const parsed = baselineSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      exists: true,
      entries: [],
      violations: [
        baselineViolation(
          file,
          "Source folder shape baseline must contain version 0 and entries of {kind, path}.",
        ),
      ],
    };
  }

  const entries = parsed.data.entries;
  const sorted = [...entries].sort(compareEntries);
  const unique = new Set(entries.map(entryKey)).size === entries.length;
  const inOrder = entries.every((entry, index) => entryKey(entry) === entryKey(sorted[index]!));

  if (!unique || !inOrder) {
    return {
      exists: true,
      entries,
      violations: [
        baselineViolation(
          file,
          "Source folder shape baseline entries must be unique and sorted by path, then kind.",
        ),
      ],
    };
  }

  return { exists: true, entries, violations: [] };
}

export function lintSourceFolderShape(root: string): ArchitectureViolation[] {
  const file = baselineFile(root);
  const baseline = readSourceFolderShapeBaselineFile(file);
  const violations = [...baseline.violations];

  if (baseline.exists && baseline.entries.length === 0 && baseline.violations.length === 0) {
    violations.push(
      baselineViolation(
        file,
        "An empty source folder shape baseline must be deleted rather than kept as an exception surface.",
      ),
    );
  }

  const findings = collectSourceFolderShapeFindings(root);
  const baselined = new Set(baseline.entries.map(entryKey));
  const current = new Set(findings.map(entryKey));

  for (const finding of findings) {
    const listed = baselined.has(entryKey(finding));
    if (listed) continue;

    violations.push({
      policy: "source-folder-shape",
      file: join(root, finding.path),
      message: finding.message,
      allowed: finding.allowed,
    });
  }

  for (const entry of baseline.entries) {
    const stillHolds = current.has(entryKey(entry));
    if (stillHolds) continue;

    violations.push(
      baselineViolation(
        file,
        `Source folder shape baseline entry ${entry.kind} ${entry.path} no longer matches anything and must be removed.`,
      ),
    );
  }

  return violations;
}
