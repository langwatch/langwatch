import { describe, expect, it } from "vitest";
import { z } from "zod/mini";

import { publishSearchIndex } from "../compile/search-index.ts";
import { decodeSearchIndex, searchIndex } from "../model/search-engine.ts";
import { searchEntrySchema } from "../model/search-entry.ts";

const index = decodeSearchIndex({
  data: JSON.parse(
    publishSearchIndex({
      entries: [
        {
          slug: "integration/python/guide",
          title: "Python Integration Guide",
          section: "Integrations",
          description: "Capture traces from Python",
          trail: "Integrations › Python",
          body: "Install the SDK. Set LANGWATCH_API_KEY before you run the evaluator harness.",
          headings: [{ id: "batch-evaluation", text: "Batch Evaluation" }],
        },
        {
          slug: "api-reference/traces/search",
          method: "POST",
          title: "Search traces",
          section: "API reference",
          description: "Query recorded traces",
          body: "POST /api/traces/search pageSize integer The page size. scrollId string",
          headings: [],
        },
      ],
    }),
  ),
});
const slugs = ({ query }: { query: string }) =>
  searchIndex({ index, query }).map((result) => result.entry.slug);

describe("when a reader searches the loaded index", () => {
  /** @scenario "Find titles, headings, body-only words, API paths and properties, and near misses" */
  it("finds every kind of match the index holds", () => {
    expect(slugs({ query: "python integration guide" })).toEqual(["integration/python/guide"]);
    expect(searchIndex({ index, query: "batch evaluation" })[0]?.heading).toEqual({
      id: "batch-evaluation",
      text: "Batch Evaluation",
    });
    expect(slugs({ query: "harness" })).toEqual(["integration/python/guide"]);
    expect(slugs({ query: "LANGWATCH_API_KEY" })).toEqual(["integration/python/guide"]);
    expect(slugs({ query: "/api/traces/search" })).toEqual(["api-reference/traces/search"]);
    expect(slugs({ query: "pagesize" })).toEqual(["api-reference/traces/search"]);
    expect(slugs({ query: "pyhton" })).toEqual(["integration/python/guide"]);
    expect(searchIndex({ index, query: "search traces" })[0]?.entry.method).toBe("POST");
  });

  it("applies the published defaults and ignores unknown fields", () => {
    const [entry] = z
      .array(searchEntrySchema)
      .parse([{ slug: "a", title: "A", section: "", description: "", headings: [], extra: true }]);
    expect(entry).toEqual({
      slug: "a",
      method: "",
      title: "A",
      section: "",
      description: "",
      trail: "",
      body: "",
      headings: [],
    });
    expect(() => z.array(searchEntrySchema).parse([{ slug: "a" }])).toThrow(/title/);
  });
});
