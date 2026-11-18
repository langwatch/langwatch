/**
 * A record write names the columns it was keyed by, in order; a write a later column edit made
 * stale is refused. Spec: specs/datasets/dataset-editor.feature
 */
import { DatasetStaleColumnsError } from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";

import { assertColumnsCurrent } from "../dataset-columns.rules.ts";

const swapped = [
  { name: "second", type: "string" },
  { name: "first", type: "string" },
];

describe("assertColumnsCurrent", () => {
  describe("given a column edit that swapped two names", () => {
    /** @scenario "A record write keyed by columns a later edit swapped is refused" */
    it("refuses a write naming the columns in their old order", () => {
      expect(() =>
        assertColumnsCurrent({ columns: ["first", "second"], columnTypes: swapped }),
      ).toThrow(DatasetStaleColumnsError);
    });

    /** @scenario "A record write keyed by columns a later edit swapped is refused" */
    it("accepts a write naming the columns in their current order", () => {
      expect(() =>
        assertColumnsCurrent({ columns: ["second", "first"], columnTypes: swapped }),
      ).not.toThrow();
    });
  });

  describe("given a column added after the write read the columns", () => {
    it("accepts the write, whose columns are all still there in order", () => {
      expect(() =>
        assertColumnsCurrent({
          columns: ["second", "first"],
          columnTypes: [...swapped, { name: "third", type: "string" }],
        }),
      ).not.toThrow();
    });
  });

  describe("given a write whose values were converted for each column's type", () => {
    const current = [{ name: "q", type: "number" }];

    /** @scenario "A file appended to a records-table dataset whose columns changed while it waited is refused" */
    it("refuses it when a later edit changed a column's type", () => {
      expect(() =>
        assertColumnsCurrent({ columns: [{ name: "q", type: "string" }], columnTypes: current }),
      ).toThrow(DatasetStaleColumnsError);
    });

    it("accepts it while every column keeps its type", () => {
      expect(() =>
        assertColumnsCurrent({ columns: [{ name: "q", type: "number" }], columnTypes: current }),
      ).not.toThrow();
    });
  });
});
