import { describe, expect, it } from "vitest";
import { replaceChipValue } from "../PlaceholderEditor";

describe("replaceChipValue", () => {
  describe("given a field:value chip segment", () => {
    describe("when the value follows the field prefix", () => {
      it("swaps the value for the label after the colon", () => {
        expect(
          replaceChipValue({
            segText: "evaluator:monitor_0005",
            value: "monitor_0005",
            label: "Ragas",
          }),
        ).toBe("evaluator:Ragas");
      });

      it("ignores a value substring inside the field name", () => {
        expect(
          replaceChipValue({
            segText: "topics:topic",
            value: "topic",
            label: "Billing",
          }),
        ).toBe("topics:Billing");
      });
    });

    describe("when the label contains replace substitution patterns", () => {
      it("inserts $-sequences verbatim", () => {
        expect(
          replaceChipValue({
            segText: "evaluator:m1",
            value: "m1",
            label: "Cost $& $' check",
          }),
        ).toBe("evaluator:Cost $& $' check");
      });
    });
  });

  describe("given a bare segment with no colon", () => {
    describe("when the value matches anywhere", () => {
      it("falls back to a plain first-occurrence swap", () => {
        expect(
          replaceChipValue({ segText: "m1", value: "m1", label: "Ragas" }),
        ).toBe("Ragas");
      });
    });
  });
});
