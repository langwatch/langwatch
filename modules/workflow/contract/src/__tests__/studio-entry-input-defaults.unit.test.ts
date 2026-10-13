import { describe, expect, it } from "vitest";

import {
  applyEntryInputDefaults,
  entryInlineWithDefaults,
} from "../studio-entry-input-defaults.ts";
import type { Entry, Field, StudioWorkflow } from "../studio-workflow.ts";

const inline = (records: Record<string, unknown[]>) => ({
  records,
  columnTypes: Object.keys(records).map((name) => ({
    name,
    type: "string" as const,
  })),
});

describe("entryInlineWithDefaults", () => {
  describe("given an entry field with a default and no column for it", () => {
    it("adds the column filled with the default for every row", () => {
      const fields: Field[] = [
        { identifier: "query", type: "str" },
        { identifier: "lang", type: "str", value: "en" },
      ];

      const result = entryInlineWithDefaults(inline({ query: ["a", "b"] }), fields);

      expect(result.records.lang).toEqual(["en", "en"]);
      expect(result.columnTypes.some((c) => c.name === "lang")).toBe(true);
    });
  });

  describe("given a column that is present but has missing cells", () => {
    /** @scenario "New Studio workflows use portable templates and entry defaults" */
    it("fills only the null/undefined cells and leaves provided values", () => {
      const fields: Field[] = [{ identifier: "lang", type: "str", value: "en" }];

      const result = entryInlineWithDefaults(inline({ lang: ["fr", null, void 0, ""] }), fields);

      // provided "fr" and explicit "" are kept; null/undefined get the default
      expect(result.records.lang).toEqual(["fr", "en", "en", ""]);
    });
  });

  describe("given a field whose default is empty or absent", () => {
    it("does not touch the records", () => {
      const fields: Field[] = [
        { identifier: "a", type: "str", value: "" },
        { identifier: "b", type: "str" },
      ];
      const original = inline({ query: ["x"] });

      const result = entryInlineWithDefaults(original, fields);

      expect(result).toBe(original);
    });
  });
});

describe("applyEntryInputDefaults", () => {
  const workflowWithEntry = (entryData: Pick<Entry, "outputs" | "dataset">): StudioWorkflow => ({
    spec_version: "1.5",
    name: "Entry defaults",
    icon: "",
    description: "",
    version: "1.0",
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        data: { entry_selection: "first", train_size: 0.8, test_size: 0.2, seed: 42, ...entryData },
      },
      { id: "other", type: "code", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [],
    state: {},
  });

  describe("given an entry node with a defaulted input missing from the dataset", () => {
    /** @scenario "New Studio workflows use portable templates and entry defaults" */
    it("backfills the entry's inline dataset with the default", () => {
      const workflow = workflowWithEntry({
        outputs: [
          { identifier: "query", type: "str" },
          { identifier: "lang", type: "str", value: "en" },
        ],
        dataset: { inline: inline({ query: ["a", "b"] }) },
      });

      const result = applyEntryInputDefaults(workflow);
      const entry = result.nodes.find((n) => n.id === "entry");
      if (!entry) throw new Error("Expected an entry node");

      expect(
        (
          entry.data as {
            dataset: { inline: { records: Record<string, unknown[]> } };
          }
        ).dataset.inline.records.lang,
      ).toEqual(["en", "en"]);
    });
  });

  describe("given an entry node with no inline dataset", () => {
    it("returns the workflow unchanged", () => {
      const workflow = workflowWithEntry({
        outputs: [{ identifier: "lang", type: "str", value: "en" }],
      });

      expect(applyEntryInputDefaults(workflow)).toBe(workflow);
    });
  });
});
