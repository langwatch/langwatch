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
 * perfectly good strings. So it is caught structurally, the same way
 * `noRawErrorToasts.unit.test.ts` catches a raw-message toast — by reading the
 * tree and asking which files call the raw serializer at all.
 *
 * Adding a file to {@link GUARDED_WRITERS} is a claim that it applies the guard
 * to both the header row and every data cell. This file checks the weak half of
 * that claim — the file does reach for the guard at all — and the per-writer
 * tests check the strong half, that the apostrophe reaches the bytes. The weak
 * half is here because it is the failure this guard was built for: deleting the
 * `neutralizeRows` call while leaving the file on the list would otherwise pass
 * both.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Both trees that ship code able to produce a file a person opens. */
const ROOTS = ["src", "ee"];

/**
 * A call to papaparse's serializer, in any of its spellings.
 *
 * Anchored on the dot so the word alone does not match: "unparseable" appears
 * in dozens of comments and error codes, and `urlunparse(parts)` is a Python
 * stdlib signature quoted inside the Monaco autocomplete table.
 */
const UNPARSE_CALL = /\.unparse\s*\(/;

/**
 * An import of the guard module, by either path shape the codebase uses.
 *
 * Deliberately weaker than "the guard is applied to the right arguments": a
 * regex cannot tell those apart, and pretending otherwise would make this file
 * look like it verifies more than it does. It catches the one regression a
 * reader would otherwise miss entirely — the guard call deleted while the file
 * stays on the allow-list.
 */
const GUARD_IMPORT =
  /from\s+["'](?:~\/utils|\.{1,2}(?:\/[^"']*)?)\/csvFormulaGuard["']/;

/**
 * The writers allowed to call the raw serializer, and what each one does about
 * the guard. Everything else must route through one of them.
 */
const GUARDED_WRITERS: Record<string, string> = {
  "src/utils/downloadCsv.ts":
    "the browser-side writer; maps neutralizeFormula over fields and rows",
  "src/server/export/scenario-runs/csv-serializer.ts":
    "server-side; every free-text cell goes through text() -> neutralizeFormula",
  "src/server/export/serializers/csv-serializer.ts":
    "server-side; headers and rows both go through neutralizeFormula",
  "src/components/batch-evaluation-results/csvExport.ts":
    "generateCsvContent applies neutralizeFormula before serializing",
  "src/pages/gateway/usage.tsx":
    "sectioned rows with no separate header row, so it guards each row in place",
};

/**
 * Below this many scanned files, assume the walk broke rather than that the
 * codebase shrank. Without it, a bad root or a thrown readdir reports "no
 * offenders" and the guard is green forever. Roughly 6,000 files match today.
 */
const SCANNED_FILE_FLOOR = 2000;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Tests may serialize freely — they assert on output, they do not ship it. */
const isTest = (relativePath: string): boolean =>
  /\.(test|spec)\.tsx?$/.test(relativePath) ||
  relativePath.split("/").includes("__tests__");

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) => {
    try {
      return walk(join(PACKAGE_ROOT, root));
    } catch {
      return [];
    }
  });
}

function callSites(): string[] {
  return sourceFiles()
    .map((path) => relative(PACKAGE_ROOT, path).split(sep).join("/"))
    .filter((path) => !isTest(path))
    .filter((path) =>
      UNPARSE_CALL.test(readFileSync(join(PACKAGE_ROOT, path), "utf8")),
    )
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
    const stale = Object.keys(GUARDED_WRITERS).filter(
      (path) => !present.has(path),
    );

    expect(stale).toEqual([]);
  });

  it("has every listed writer actually reaching for the guard", () => {
    const notReaching = Object.keys(GUARDED_WRITERS).filter(
      (path) =>
        !GUARD_IMPORT.test(readFileSync(join(PACKAGE_ROOT, path), "utf8")),
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
  ])("matches %s", (_label, source) => {
    expect(UNPARSE_CALL.test(source)).toBe(true);
  });

  it.each([
    ["the adjective", `// an unparseable cursor is treated as absent`],
    [
      "an error code",
      `export const LWQL_UNPARSEABLE_CODE = "lwql_unparseable";`,
    ],
    ["a quoted foreign signature", `fn("urlunparse", "urlunparse(parts)")`],
  ])("does not match %s", (_label, source) => {
    expect(UNPARSE_CALL.test(source)).toBe(false);
  });
});
