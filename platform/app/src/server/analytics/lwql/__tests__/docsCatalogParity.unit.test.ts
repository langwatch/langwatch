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

/** Every view name named in the docs' bounded table section, first column only. */
function docsViewNames(): string[] {
  const doc = readFileSync(DOCS_PATH, "utf-8");
  const startIndex = doc.indexOf(VIEWS_SECTION_START);
  const endIndex = doc.indexOf(VIEWS_SECTION_END);
  expect(startIndex, `${VIEWS_SECTION_START} marker present`).toBeGreaterThan(
    -1,
  );
  expect(endIndex, `${VIEWS_SECTION_END} marker present`).toBeGreaterThan(-1);

  const section = doc.slice(startIndex, endIndex);
  const rowPattern = /^\|\s*`([a-z_][a-z0-9_]*)`\s*\|/gm;
  const names: string[] = [];
  for (const match of section.matchAll(rowPattern)) {
    names.push(match[1]!);
  }
  return names;
}

describe("LWQL docs-catalog parity", () => {
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
