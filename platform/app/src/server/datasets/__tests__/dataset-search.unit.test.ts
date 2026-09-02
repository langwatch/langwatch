import { describe, expect, it } from "vitest";

import {
  DATASET_SEARCH_MAX_ROWS,
  matchesDatasetSearch,
  normalizeDatasetSearch,
} from "../dataset-search";

describe("normalizeDatasetSearch()", () => {
  it("treats a blank search as no search at all", () => {
    expect(normalizeDatasetSearch(undefined)).toBeUndefined();
    expect(normalizeDatasetSearch("")).toBeUndefined();
    expect(normalizeDatasetSearch("   ")).toBeUndefined();
  });

  it("trims the search so stray whitespace does not change the matches", () => {
    expect(normalizeDatasetSearch("  escalation  ")).toBe("escalation");
  });
});

describe("matchesDatasetSearch()", () => {
  const entry = {
    conversation_id: "conv_0390",
    input: "The customer asked for an Escalation to a manager",
    expected_output: "Escalate to tier 2",
    turns: 4,
    resolved: false,
    metadata: { channel: "email" },
    unanswered: null,
  };

  it("matches a cell value", () => {
    expect(matchesDatasetSearch({ entry: entry, search: "manager" })).toBe(
      true,
    );
  });

  /** @scenario Search matches regardless of letter case */
  it("matches regardless of letter case", () => {
    expect(matchesDatasetSearch({ entry: entry, search: "escalation" })).toBe(
      true,
    );
    expect(matchesDatasetSearch({ entry: entry, search: "ESCALATION" })).toBe(
      true,
    );
  });

  /** @scenario A word that only appears in a column name matches nothing */
  it("does not match a word that only appears in a column name", () => {
    // Matching column names too would make "id" return every row of a dataset
    // with a `conversation_id` column — a result the user cannot explain from
    // what is on screen.
    expect(
      matchesDatasetSearch({
        entry: { escalation: "none" },
        search: "escalation",
      }),
    ).toBe(false);
  });

  it("matches inside non-string values rather than skipping them", () => {
    expect(matchesDatasetSearch({ entry: entry, search: "4" })).toBe(true);
    expect(matchesDatasetSearch({ entry: entry, search: "false" })).toBe(true);
    expect(matchesDatasetSearch({ entry: entry, search: "email" })).toBe(true);
  });

  it("does not match null or missing values", () => {
    expect(
      matchesDatasetSearch({
        entry: { a: null, b: undefined },
        search: "null",
      }),
    ).toBe(false);
  });

  it("reports no match when nothing contains the text", () => {
    expect(matchesDatasetSearch({ entry: entry, search: "refund" })).toBe(
      false,
    );
  });

  it("survives an entry that is not an object", () => {
    // `adaptS3JsonlRecord` assigns `entry` straight from a JSONL line with no
    // shape check (datasetRecord.utils.ts:248), so a line of `null` — or a bare
    // scalar — reaches this predicate. Ordinary paging tolerates such a row and
    // renders it blank; a search must not be the one path that throws on data
    // the rest of the editor survives, because it fails the WHOLE search, not
    // the one row.
    expect(() =>
      matchesDatasetSearch({ entry: null as never, search: "escalation" }),
    ).not.toThrow();
    expect(
      matchesDatasetSearch({ entry: null as never, search: "escalation" }),
    ).toBe(false);
    expect(
      matchesDatasetSearch({ entry: undefined as never, search: "escalation" }),
    ).toBe(false);
    expect(
      matchesDatasetSearch({
        entry: "escalation" as never,
        search: "escalation",
      }),
    ).toBe(false);
    expect(matchesDatasetSearch({ entry: 42 as never, search: "4" })).toBe(
      false,
    );
  });
});

describe("DATASET_SEARCH_MAX_ROWS", () => {
  it("caps how many rows one search will read", () => {
    // Rows rather than bytes: legacy postgres-backed datasets carry a null
    // `sizeBytes`, so a byte cap would never fire for them, and the real cost
    // of an s3_jsonl search is chunk reads, not heap.
    expect(DATASET_SEARCH_MAX_ROWS).toBe(50_000);
  });
});
