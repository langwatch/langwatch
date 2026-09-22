/**
 * The LWQL docs page (docs/api-reference/query/overview.mdx) carries a
 * human-readable table of every queryable view, bounded by the
 * MDX comment markers named by {@link VIEWS_SECTION_START} / {@link VIEWS_SECTION_END}. It exists
 * because `GET /api/v1/query/schema` is machine-readable but nobody reads an
 * API response to learn what's queryable — an agent or engineer reads the
 * docs page first.
 *
 * A view added to {@link LWQL_VIEW_CATALOG} without a matching docs row is a
 * silent gap: the feature ships, but nothing tells a caller it exists. This
 * test parses the doc's view table and asserts the name set is exactly the
 * catalog's, in both directions, so neither side can drift from the other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";

const DOCS_PATH = join(
  process.cwd(),
  "../../docs/api-reference/query/overview.mdx",
);

const VIEWS_SECTION_START = "{/* lwql-views-start */}";
const VIEWS_SECTION_END = "{/* lwql-views-end */}";

/** One row of the docs' view table: the view name and its description cell. */
interface DocsViewRow {
  readonly name: string;
  readonly description: string;
}

/** Every row of the docs' bounded table section: first (name) and second (description) columns. */
function docsViewRows(): DocsViewRow[] {
  const doc = readFileSync(DOCS_PATH, "utf-8");
  const startIndex = doc.indexOf(VIEWS_SECTION_START);
  const endIndex = doc.indexOf(VIEWS_SECTION_END);
  expect(startIndex, `${VIEWS_SECTION_START} marker present`).toBeGreaterThan(
    -1,
  );
  expect(endIndex, `${VIEWS_SECTION_END} marker present`).toBeGreaterThan(-1);

  const section = doc.slice(startIndex, endIndex);
  // `| \`name\` | description | …`: the description is the cell between the
  // first and second pipe after the name. A table cell carries no raw pipe.
  const rowPattern = /^\|\s*`([a-z_][a-z0-9_]*)`\s*\|\s*([^|]*?)\s*\|/gm;
  const rows: DocsViewRow[] = [];
  for (const match of section.matchAll(rowPattern)) {
    rows.push({ name: match[1]!, description: match[2]! });
  }
  return rows;
}

/** Every view name named in the docs' bounded table section, first column only. */
function docsViewNames(): string[] {
  return docsViewRows().map((row) => row.name);
}

describe("LWQL docs-catalog parity", () => {
  // The docs' published view list is derived from the same catalog the include
  // lists feed, so a byte-identical published surface after the opt-out → opt-in
  // flip is exactly what "the docs name every catalog view, both directions"
  // proves here (the fixture regeneration proves the machine-readable half).
  /** @scenario "The catalogued views regenerate byte-identical from the include lists" */
  it("lists exactly the catalog's view names, both directions", () => {
    const catalogNames = new Set(LWQL_VIEW_CATALOG.map((view) => view.name));
    const docNames = docsViewNames();
    const docNameSet = new Set(docNames);

    const missingFromDocs = [...catalogNames].filter(
      (name) => !docNameSet.has(name),
    );
    const extraInDocs = docNames.filter((name) => !catalogNames.has(name));

    expect(missingFromDocs, "catalog views missing from docs").toEqual([]);
    expect(extraInDocs, "docs rows naming a view not in the catalog").toEqual(
      [],
    );
  });

  it("gives each view the description the catalog produces", () => {
    const catalogDescription = new Map(
      LWQL_VIEW_CATALOG.map((view) => [view.name, view.description]),
    );
    const mismatches = docsViewRows()
      .filter((row) => catalogDescription.has(row.name))
      .filter((row) => row.description !== catalogDescription.get(row.name))
      .map(
        (row) =>
          `${row.name}\n  docs:    ${row.description}\n  catalog: ${catalogDescription.get(row.name)}`,
      );

    expect(
      mismatches,
      "docs rows whose description drifts from the catalog",
    ).toEqual([]);
  });

  it("names each view exactly once", () => {
    const docNames = docsViewNames();
    const seen = new Set<string>();
    const duplicates = docNames.filter((name) => {
      if (seen.has(name)) return true;
      seen.add(name);
      return false;
    });

    expect(duplicates).toEqual([]);
  });
});
