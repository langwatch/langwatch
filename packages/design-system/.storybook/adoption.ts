/**
 * Adoption numbers for the workshop, read from the import sites at build time:
 * which files import each entry point (and each name from it), plus the debt
 * the Consistency pages count. `node .storybook/adoption.ts` prints the inventory.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PACKAGE_ROOT, publishedEntries, storyExists, storyFor } from "./catalogue.ts";

const ROOT = path.resolve(PACKAGE_ROOT, "../..");
const CONSUMER_DIRS = ["apps", "modules", "enterprise", "packages"];
const SOURCE_GLOBS = CONSUMER_DIRS.flatMap((dir) => [`${dir}/*.ts`, `${dir}/*.tsx`]);
const NOT_CONSUMER = [
  ":(exclude)packages/design-system",
  ":(exclude)packages/design-system-internal",
];
const BROWSER_SOURCES = [
  "apps/ui/src/*.tsx",
  "apps/ui/src/*.ts",
  "modules/*/browser/src/*.tsx",
  "modules/*/browser/src/*.ts",
  "enterprise/modules/*/browser/src/*.tsx",
  "enterprise/modules/*/browser/src/*.ts",
  ":(exclude)*.test.ts",
  ":(exclude)*.test.tsx",
  ":(exclude)*/__tests__/*",
];

export type Usage = { files: number; owners: Record<string, number> };
export type Debt = { files: number; sites: number; worst: { file: string; sites: number }[] };
export type Adoption = {
  entries: Record<
    string,
    Usage & { story?: string; storyMissing: boolean; names: Record<string, number> }
  >;
  debt: {
    directChakra: Debt;
    rawColour: Debt;
    paletteStep: Debt;
    handRolledTable: Debt;
  };
};

/** `git grep` over the consumer tree; tracked and untracked files alike. */
function grep({ pattern, paths }: { pattern: string; paths: string[] }): string[] {
  try {
    return execFileSync(
      "git",
      ["grep", "--untracked", "-I", "-n", "-o", "-E", pattern, "--", ...paths],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    )
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

/** `modules/trace/browser/src/x.tsx` -> `modules/trace/browser`. */
const OWNER_DEPTH: Record<string, number> = { enterprise: 4, modules: 3 };

function ownerOf({ file }: { file: string }): string {
  const parts = file.split("/");
  return parts.slice(0, OWNER_DEPTH[parts[0] ?? ""] ?? 2).join("/");
}

const fileOf = (line: string) => line.slice(0, line.indexOf(":"));

function debtFrom({ lines }: { lines: string[] }): Debt {
  const perFile = new Map<string, number>();
  for (const line of lines) {
    const file = fileOf(line);
    perFile.set(file, (perFile.get(file) ?? 0) + 1);
  }
  const worst = [...perFile]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([file, sites]) => ({ file, sites }));
  return { files: perFile.size, sites: lines.length, worst };
}

const IMPORT_CLAUSE =
  /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@langwatch\/design-system(\/[\w.-]+)?["']/g;

/** Which files import each entry point. */
function importersBySubpath(): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  for (const line of grep({
    pattern: "@langwatch/design-system(/[A-Za-z0-9._-]+)?[\"']",
    paths: [...SOURCE_GLOBS, ...NOT_CONSUMER],
  })) {
    const [file = "", , match = ""] = line.split(":");
    const subpath = `.${match.slice("@langwatch/design-system".length, -1)}`;
    files.set(subpath, (files.get(subpath) ?? new Set()).add(file));
  }
  return files;
}

/** How many files import each name from each entry point. */
function namesBySubpath({ files }: { files: Set<string> }): Map<string, Map<string, number>> {
  const names = new Map<string, Map<string, number>>();
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const [, clause = "", sub = ""] of source.matchAll(IMPORT_CLAUSE)) {
      const counts = names.get(`.${sub}`) ?? new Map<string, number>();
      const imported = clause.split(",").map((raw) =>
        raw
          .replace(/^\s*type\s+/, "")
          .split(/\s+as\s+/)[0]
          ?.trim(),
      );
      for (const name of imported) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      names.set(`.${sub}`, counts);
    }
  }
  return names;
}

export function collectAdoption(): Adoption {
  const filesBySubpath = importersBySubpath();
  const names = namesBySubpath({
    files: new Set([...filesBySubpath.values()].flatMap((files) => [...files])),
  });

  const entries: Adoption["entries"] = {};
  for (const { subpath, source } of publishedEntries()) {
    const files = [...(filesBySubpath.get(subpath) ?? [])];
    const owners: Record<string, number> = {};
    for (const file of files) owners[ownerOf({ file })] = (owners[ownerOf({ file })] ?? 0) + 1;
    const story = storyFor({ source });
    entries[subpath] = {
      files: files.length,
      owners,
      story,
      storyMissing: story !== undefined && !storyExists({ story }),
      names: Object.fromEntries([...(names.get(subpath) ?? [])].toSorted((a, b) => b[1] - a[1])),
    };
  }

  const listTableFiles = new Set(filesBySubpath.get("./list-table") ?? []);

  return {
    entries,
    debt: {
      directChakra: debtFrom({
        lines: grep({
          pattern: "from [\"']@(chakra-ui|emotion)/",
          paths: [...SOURCE_GLOBS, ...NOT_CONSUMER],
        }),
      }),
      rawColour: debtFrom({
        lines: grep({ pattern: "[\"'`](#[0-9a-fA-F]{3,8}|rgba?\\()", paths: BROWSER_SOURCES }),
      }),
      paletteStep: debtFrom({
        lines: grep({
          pattern:
            "(color|bg|background|borderColor|fill|stroke)=[\"'{]+(gray|red|orange|yellow|green|teal|blue|cyan|purple|pink|zinc)\\.[0-9]{2,3}[\"']",
          paths: BROWSER_SOURCES,
        }),
      }),
      handRolledTable: debtFrom({
        lines: grep({ pattern: "Table\\.Root", paths: BROWSER_SOURCES }).filter(
          (line) => !listTableFiles.has(fileOf(line)),
        ),
      }),
    },
  };
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(collectAdoption(), null, 2)}\n`);
}
