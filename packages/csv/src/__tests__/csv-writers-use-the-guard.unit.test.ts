/**
 * Stops CSV writers from growing back outside the formula guard.
 *
 * A cell opening with `=`, `+`, `-`, `@`, TAB or CR is executed as a formula by
 * Excel and Sheets. RFC 4180 quoting does not stop that — quoting protects the
 * CSV grammar, not the spreadsheet reading it — so the only defence is a
 * leading apostrophe, and papaparse does not add one.
 *
 * The guard was written once and then bypassed seven times, because
 * `Parse.unparse` is the obvious call to reach for and nothing objected. Each
 * bypass was individually reasonable and collectively meant the property was
 * true of one export surface rather than of the product.
 *
 * A type cannot catch this: `unparse` takes strings and every offender passed
 * perfectly good strings. So it is caught structurally, by reading the tree and
 * asking which files call the raw serializer at all.
 *
 * Adding a file to GUARDED_WRITERS is a claim that it applies the guard to both
 * the header row and every data cell. This file checks the weak half of that
 * claim — the file does reach for the guard at all — and the per-writer tests
 * check the strong half, that the apostrophe reaches the bytes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Both trees that ship code able to produce a file a person opens. */
const ROOTS = ["packages", "apps"];

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", ".claude", ".turbo"]);

/**
 * Any reference to papaparse's serializer by name — a direct `Parse.unparse(`,
 * a destructured `import { unparse }`, or an alias like
 * `const serialize = Parse.unparse`. All of them have to write the word
 * somewhere, so matching the bare word catches the alias shapes a
 * call-site-only regex misses. The word boundaries keep "unparseable" (comments
 * and error codes) and `urlunparse(parts)` (a Python signature quoted in the
 * Monaco autocomplete table) from matching: both bury the word inside a longer
 * one, so the boundary fails.
 */
const UNPARSE_CALL = /\bunparse\b/;

/**
 * An import of the guard package, by either entry point. Deliberately weaker
 * than "the guard is applied to the right arguments": a regex cannot tell those
 * apart. It catches the one regression a reader would otherwise miss entirely —
 * the guard call deleted while the file stays on the allow-list.
 */
const GUARD_IMPORT = /from\s+["'](?:@langwatch\/csv(?:\/download)?|\.\/formula-guard)["']/;

/**
 * The writers allowed to call the raw serializer, and what each one does about
 * the guard. Everything else must route through one of them.
 */
const GUARDED_WRITERS: Record<string, string> = {
  "packages/csv/src/download-csv.ts":
    "the browser-side writer; maps neutralizeFormula over fields and rows",
  "packages/features/scenario/server/src/services/scenario-run-export-csv.rules.ts":
    "server-side; every free-text cell goes through text() -> neutralizeFormula",
  "packages/features/trace/server/src/services/trace-export-csv.rules.ts":
    "server-side; headers and rows both go through neutralizeFormula",
  "packages/features/experiment/web/src/ui/sections/batch-evaluation-results.csv.ts":
    "generateCsvContent applies neutralizeFormula before serializing",
  "packages/features/gateway/web/src/screens/gateway/gateway-usage.screen.tsx":
    "sectioned rows with no separate header row, so it guards each row in place",
  "packages/features/organization/web/src/screens/organization/audit-log.screen.tsx":
    "hands the file to the host rather than the DOM, so it guards fields and rows in place",
};

/**
 * Serializers whose output is never handed to a person.
 *
 * `parse-tabular-file` converts an uploaded JSON file into the CSV text the
 * import parser reads back moments later. A leading apostrophe there would be
 * stored as part of the dataset value, so guarding it corrupts data rather than
 * protecting a reader.
 */
const INTERNAL_SERIALIZERS = new Set(["packages/features/dataset/web/src/model/parse-tabular-file.ts"]);

/**
 * Below this many scanned files, assume the walk broke rather than that the
 * codebase shrank. A missing root throws on its own; this catches the quieter
 * failure where the walk runs but matches almost nothing.
 */
const SCANNED_FILE_FLOOR = 2000;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Tests may serialize freely — they assert on output, they do not ship it. */
const isTest = (relativePath: string): boolean =>
  /\.(test|spec)\.tsx?$/.test(relativePath) || relativePath.split("/").includes("__tests__");

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));
}

function callSites(): string[] {
  return sourceFiles()
    .map((path) => relative(REPO_ROOT, path).split(sep).join("/"))
    .filter((path) => !isTest(path))
    .filter((path) => UNPARSE_CALL.test(readFileSync(join(REPO_ROOT, path), "utf8")))
    .filter((path) => !INTERNAL_SERIALIZERS.has(path))
    .sort();
}

describe("every CSV the product writes goes through the formula guard", () => {
  it("finds enough files to be scanning the tree at all", () => {
    expect(sourceFiles().length).toBeGreaterThan(SCANNED_FILE_FLOOR);
  });

  it("has no writer calling the raw serializer outside the guarded set", () => {
    const unguarded = callSites().filter((path) => !(path in GUARDED_WRITERS));

    expect(unguarded).toEqual([]);
  });

  it("keeps the guarded set honest about which files still exist", () => {
    const present = new Set(callSites());
    const stale = Object.keys(GUARDED_WRITERS).filter((path) => !present.has(path));

    expect(stale).toEqual([]);
  });

  it("has every listed writer actually reaching for the guard", () => {
    const notReaching = Object.keys(GUARDED_WRITERS).filter(
      (path) => !GUARD_IMPORT.test(readFileSync(join(REPO_ROOT, path), "utf8")),
    );

    expect(notReaching).toEqual([]);
  });
});

/**
 * The detector's own test. Without it, "no offenders" and "matches nothing"
 * look identical, and this shape of guard has shipped in the second state
 * before.
 */
describe("the unparse detector", () => {
  it.each([
    ["a namespaced call", `const csv = Parse.unparse({ fields, data });`],
    ["a bare method call", `writer.unparse(rows)`],
    ["spaced", `Parse.unparse ({ fields, data })`],
    ["a destructured import", `import { unparse } from "papaparse";`],
    ["an alias assignment", `const serialize = Parse.unparse;`],
  ])("matches %s", (_label, source) => {
    expect(UNPARSE_CALL.test(source)).toBe(true);
  });

  it.each([
    ["the adjective", `// an unparseable cursor is treated as absent`],
    ["an error code", `export const LWQL_UNPARSEABLE_CODE = "lwql_unparseable";`],
    ["a quoted foreign signature", `fn("urlunparse", "urlunparse(parts)")`],
  ])("does not match %s", (_label, source) => {
    expect(UNPARSE_CALL.test(source)).toBe(false);
  });
});
