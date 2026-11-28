import { describe, expect, it } from "vitest";

import { matchesDatasetSearch, normalizeDatasetSearch } from "../../rules/dataset-search.rules.ts";

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
    expect(matchesDatasetSearch({ entry: entry, search: "manager" })).toBe(true);
  });

  /** @scenario Search matches regardless of letter case */
  it("matches regardless of letter case", () => {
    expect(matchesDatasetSearch({ entry: entry, search: "escalation" })).toBe(true);
    expect(matchesDatasetSearch({ entry: entry, search: "ESCALATION" })).toBe(true);
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
    expect(matchesDatasetSearch({ entry: entry, search: "refund" })).toBe(false);
  });

  it("survives an entry that is not an object", () => {
    // `adaptS3JsonlRecord` assigns `entry` straight from a JSONL line with no
    // shape check, so a line of `null` or a bare scalar reaches this
    // predicate. Ordinary paging tolerates such a row and renders it blank;
    // a search must not fail the WHOLE search over the one row it can't survive.
    expect(() =>
      matchesDatasetSearch({ entry: null as never, search: "escalation" }),
    ).not.toThrow();
    expect(matchesDatasetSearch({ entry: null as never, search: "escalation" })).toBe(false);
    expect(matchesDatasetSearch({ entry: undefined as never, search: "escalation" })).toBe(false);
    expect(
      matchesDatasetSearch({
        entry: "escalation" as never,
        search: "escalation",
      }),
    ).toBe(false);
    expect(matchesDatasetSearch({ entry: 42 as never, search: "4" })).toBe(false);
  });
});
