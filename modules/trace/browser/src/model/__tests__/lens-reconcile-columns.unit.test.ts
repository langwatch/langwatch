import { describe, expect, it } from "vitest";

import { columnsForGrouping, getCapability, reconcileColumns } from "../lens-capabilities.ts";

const flat = getCapability("flat");

describe("reconcileColumns", () => {
  describe("given the flat (trace) capability", () => {
    describe("when the saved columns include per-evaluator eval ids", () => {
      it("preserves eval:* ids even though they are not in the capability list", () => {
        const result = reconcileColumns({
          ids: ["time", "trace", "eval:score:evaluator_abc", "eval:verdict:Toxicity"],
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

describe("columnsForGrouping", () => {
  describe("given the flat lens's columns", () => {
    /** @scenario "Selecting a grouping transforms the table" */
    it("starts a grouped lens from its defaults, so the group label and count show", () => {
      const result = columnsForGrouping({
        ids: ["time", "trace", "origin", "duration", "cost", "tokens"],
        capability: getCapability("by-model"),
      });
      expect(result).toEqual(["group", "count", "duration", "cost", "tokens", "errors"]);
    });
  });

  describe("given a grouped lens's columns", () => {
    /** @scenario "Selecting flat restores the ungrouped table" */
    it("starts the flat lens from its defaults, so time and trace show", () => {
      const result = columnsForGrouping({
        ids: ["group", "count", "duration", "cost", "tokens", "errors"],
        capability: flat,
      });
      expect(result.slice(0, 2)).toEqual(["time", "trace"]);
    });

    it("keeps the user's columns when the identity column survives", () => {
      const result = columnsForGrouping({
        ids: ["group", "cost"],
        capability: getCapability("by-service"),
      });
      expect(result).toEqual(["group", "cost"]);
    });
  });
});
