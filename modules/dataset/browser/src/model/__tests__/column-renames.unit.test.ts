/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { columnRenamesOf, recordsBySource, withSources } from "../column-renames.ts";

describe("column renames", () => {
  const loaded = withSources([
    { name: "first", type: "string" },
    { name: "second", type: "string" },
  ]);

  describe("when one column is deleted and another renamed", () => {
    const edited = [
      { ...loaded[1]!, name: "renamed" },
      { name: "added", type: "string" },
    ];

    /** @scenario "A save that deletes one column and renames another keeps the renamed column's values" */
    it("names only the rename", () => {
      expect(columnRenamesOf(edited)).toEqual([{ from: "second", to: "renamed" }]);
    });

    /** @scenario "A save that deletes one column and renames another keeps the renamed column's values" */
    it("moves each record's values with their column and leaves the new one out", () => {
      expect(
        recordsBySource([{ id: "r1", first: "deleted value", second: "kept value" }], edited),
      ).toEqual([{ id: "r1", renamed: "kept value" }]);
    });
  });

  describe("when nothing was renamed", () => {
    it("names no renames", () => {
      expect(columnRenamesOf(loaded)).toEqual([]);
    });
  });
});
