import { describe, expect, it } from "vitest";

import type { Field, Workflow } from "../../types/dsl";
import {
  applyEntryInputDefaults,
  entryInlineWithDefaults,
} from "../entryInputDefaults";

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

      const result = entryInlineWithDefaults(
        inline({ query: ["a", "b"] }),
        fields,
      );

      expect(result.records.lang).toEqual(["en", "en"]);
      expect(result.columnTypes.some((c) => c.name === "lang")).toBe(true);
    });
  });

  describe("given a column that is present but has missing cells", () => {
    it("fills only the null/undefined cells and leaves provided values", () => {
      const fields: Field[] = [
        { identifier: "lang", type: "str", value: "en" },
      ];

      const result = entryInlineWithDefaults(
        inline({ lang: ["fr", null, undefined, ""] }),
        fields,
      );

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
  const workflowWithEntry = (entryData: Record<string, unknown>): Workflow =>
    ({
      nodes: [
        {
          id: "entry",
          type: "entry",
          data: entryData,
        },
        { id: "other", type: "code", data: {} },
      ],
      edges: [],
    }) as unknown as Workflow;

  describe("given an entry node with a defaulted input missing from the dataset", () => {
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

      expect((entry?.data as any).dataset.inline.records.lang).toEqual([
        "en",
        "en",
      ]);
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
