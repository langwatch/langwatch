import { describe, expect, it } from "vitest";
import { timeColumnSizing } from "../../../stores/timeFormatStore";
import { getTraceColumnDef } from "../columns";

describe("getTraceColumnDef", () => {
  describe("given the Time column", () => {
    it("defaults to the relative-mode footprint", () => {
      // The static def is the relative footprint; ISO mode swaps in the
      // wider one through useTraceLensColumns. Lock the two in sync so the
      // default column never silently drifts from the store's helper.
      const def = getTraceColumnDef("time");
      const relative = timeColumnSizing("relative");
      expect(def).toMatchObject({
        id: "time",
        size: relative.size,
        minSize: relative.minSize,
        maxSize: relative.maxSize,
      });
    });
  });
});
