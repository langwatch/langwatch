/**
 * The LangWatchQL docs page carries a table of every queryable view between two
 * MDX markers. A view added to the catalog with no docs row ships unannounced,
 * so the table and the catalog must name the same views with the same words.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const DOCS_PATH = fileURLToPath(
  new URL("../../../../../../docs/api-reference/query/overview.mdx", import.meta.url),
);

const VIEWS_SECTION_START = "{/* lwql-views-start */}";
const VIEWS_SECTION_END = "{/* lwql-views-end */}";

/** One row of the docs' view table: the view name and its description cell. */
interface DocsViewRow {
  readonly name: string;
  readonly description: string;
}

function docsViewRows(): DocsViewRow[] {
  const doc = readFileSync(DOCS_PATH, "utf-8");
  const startIndex = doc.indexOf(VIEWS_SECTION_START);
  const endIndex = doc.indexOf(VIEWS_SECTION_END);
  expect(startIndex, `${VIEWS_SECTION_START} marker present`).toBeGreaterThan(-1);
  expect(endIndex, `${VIEWS_SECTION_END} marker present`).toBeGreaterThan(-1);

  // `| \`name\` | description | …`: a table cell carries no raw pipe.
  const rowPattern = /^\|\s*`([a-z_][a-z0-9_]*)`\s*\|\s*([^|]*?)\s*\|/gm;
  return [...doc.slice(startIndex, endIndex).matchAll(rowPattern)].map((match) => ({
    name: match[1] ?? "",
    description: match[2] ?? "",
  }));
}

describe("given the LangWatchQL docs page and the view catalog", () => {
  describe("when the docs' view table is read", () => {
    it("lists exactly the catalog's view names, both directions", () => {
      const catalogNames = new Set(LWQL_VIEW_CATALOG.map((view) => view.name));
      const docNames = docsViewRows().map((row) => row.name);
      const docNameSet = new Set(docNames);

      expect(
        [...catalogNames].filter((name) => !docNameSet.has(name)),
        "catalog views missing from docs",
      ).toEqual([]);
      expect(
        docNames.filter((name) => !catalogNames.has(name)),
        "docs rows naming a view not in the catalog",
      ).toEqual([]);
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

      expect(mismatches, "docs rows whose description drifts from the catalog").toEqual([]);
    });

    it("names each view exactly once", () => {
      const seen = new Set<string>();
      const duplicates = docsViewRows()
        .map((row) => row.name)
        .filter((name) => {
          if (seen.has(name)) return true;
          seen.add(name);
          return false;
        });

      expect(duplicates).toEqual([]);
    });
  });
});
