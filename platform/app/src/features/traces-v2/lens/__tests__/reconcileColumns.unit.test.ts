import { describe, expect, it } from "vitest";
import { getCapability, reconcileColumns } from "../capabilities";

const flat = getCapability("flat");

describe("reconcileColumns", () => {
  describe("given the flat (trace) capability", () => {
    describe("when the saved columns include per-evaluator eval ids", () => {
      it("preserves eval:* ids even though they are not in the capability list", () => {
        const result = reconcileColumns({
          ids: [
            "time",
            "trace",
            "eval:score:evaluator_abc",
            "eval:verdict:Toxicity",
          ],
          capability: flat,
        });
        expect(result).toContain("eval:score:evaluator_abc");
        expect(result).toContain("eval:verdict:Toxicity");
      });

      it("keeps an eval column whose evaluator is absent from the capability", () => {
        // The evaluator may simply have no runs in range — the column stays
        // and renders em-dashes rather than being dropped.
        const result = reconcileColumns({
          ids: ["time", "eval:label:gone"],
          capability: flat,
        });
        expect(result).toContain("eval:label:gone");
      });
    });

    describe("when the saved columns include an unknown static id", () => {
      it("drops the unknown id but keeps valid ones", () => {
        const result = reconcileColumns({
          ids: ["time", "not-a-column", "cost"],
          capability: flat,
        });
        expect(result).not.toContain("not-a-column");
        expect(result).toEqual(expect.arrayContaining(["time", "cost"]));
      });
    });
  });

  describe("given a non-trace grouping capability", () => {
    describe("when reconciling against a non-trace grouping", () => {
      it("drops eval:* ids — eval columns are trace-grouping only", () => {
        const result = reconcileColumns({
          ids: ["group", "count", "eval:score:e1"],
          capability: getCapability("by-service"),
        });
        expect(result).not.toContain("eval:score:e1");
      });
    });
  });
});
