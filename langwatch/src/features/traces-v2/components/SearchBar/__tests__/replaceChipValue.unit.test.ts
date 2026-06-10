import { describe, expect, it } from "vitest";
import { replaceChipValue } from "../PlaceholderEditor";

describe("replaceChipValue", () => {
  describe("when the value follows the field prefix", () => {
    it("swaps the value for the label after the colon", () => {
      expect(
        replaceChipValue("evaluator:monitor_0005", "monitor_0005", "Ragas"),
      ).toBe("evaluator:Ragas");
    });

    it("ignores a value substring inside the field name", () => {
      expect(replaceChipValue("topics:topic", "topic", "Billing")).toBe(
        "topics:Billing",
      );
    });
  });

  describe("when the label contains replace substitution patterns", () => {
    it("inserts $-sequences verbatim", () => {
      expect(replaceChipValue("evaluator:m1", "m1", "Cost $& $' check")).toBe(
        "evaluator:Cost $& $' check",
      );
    });
  });

  describe("when the segment has no colon", () => {
    it("falls back to a plain first-occurrence swap", () => {
      expect(replaceChipValue("m1", "m1", "Ragas")).toBe("Ragas");
    });
  });
});
