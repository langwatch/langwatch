import { describe, expect, it } from "vitest";
import type { DatasetConfirmColumns } from "~/server/datasets/types";
import { reorderColumnsBySourceHeader } from "../columnReorder";

const cols: DatasetConfirmColumns = [
  { name: "a", type: "string", sourceHeader: "a" },
  { name: "b", type: "number", sourceHeader: "b" },
  { name: "c", type: "boolean", sourceHeader: "c" },
];

describe("given confirm columns bound by sourceHeader", () => {
  describe("when a column is dropped onto a later column", () => {
    it("moves it into that slot, preserving each column's sourceHeader/type", () => {
      const next = reorderColumnsBySourceHeader({
        columns: cols,
        activeSourceHeader: "a",
        overSourceHeader: "c",
      });
      expect(next).toEqual([
        { name: "b", type: "number", sourceHeader: "b" },
        { name: "c", type: "boolean", sourceHeader: "c" },
        { name: "a", type: "string", sourceHeader: "a" },
      ]);
    });
  });

  describe("when a column is dropped onto an earlier column", () => {
    it("moves it up to that slot", () => {
      const next = reorderColumnsBySourceHeader({
        columns: cols,
        activeSourceHeader: "c",
        overSourceHeader: "a",
      });
      expect(next.map((c) => c.sourceHeader)).toEqual(["c", "a", "b"]);
    });
  });

  describe("when the column is dropped on itself", () => {
    it("returns the same array reference (no-op)", () => {
      expect(
        reorderColumnsBySourceHeader({
          columns: cols,
          activeSourceHeader: "b",
          overSourceHeader: "b",
        }),
      ).toBe(cols);
    });
  });

  describe("when active or over header is unknown", () => {
    it("returns the same array reference (no-op)", () => {
      expect(
        reorderColumnsBySourceHeader({
          columns: cols,
          activeSourceHeader: "a",
          overSourceHeader: "zzz",
        }),
      ).toBe(cols);
      expect(
        reorderColumnsBySourceHeader({
          columns: cols,
          activeSourceHeader: "zzz",
          overSourceHeader: "a",
        }),
      ).toBe(cols);
    });
  });
});
