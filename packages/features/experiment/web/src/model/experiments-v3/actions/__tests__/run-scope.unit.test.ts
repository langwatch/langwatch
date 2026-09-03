import { describe, expect, it } from "vitest";
import { scopeFromRunPayload } from "../run-scope";
import { runPayloadSchema } from "../schemas";

describe("scopeFromRunPayload", () => {
  describe("when the payload names both targets and rows", () => {
    it("keeps both filters instead of letting one win", () => {
      expect(scopeFromRunPayload({ targetIds: ["t2"], rowIndices: [0, 1, 2] })).toEqual({
        type: "target-rows",
        targetIds: ["t2"],
        rowIndices: [0, 1, 2],
      });
    });
  });

  describe("when the payload names only one filter", () => {
    it("maps a single target to the target scope", () => {
      expect(scopeFromRunPayload({ targetIds: ["t1"] })).toEqual({
        type: "target",
        targetId: "t1",
      });
    });

    it("maps several targets without rows to target-rows over every row", () => {
      expect(scopeFromRunPayload({ targetIds: ["t1", "t2"] })).toEqual({
        type: "target-rows",
        targetIds: ["t1", "t2"],
      });
    });

    it("maps rows without targets to the rows scope", () => {
      expect(scopeFromRunPayload({ rowIndices: [3] })).toEqual({
        type: "rows",
        rowIndices: [3],
      });
    });
  });

  describe("when the payload names nothing", () => {
    it("runs everything", () => {
      expect(scopeFromRunPayload({})).toEqual({ type: "full" });
      expect(scopeFromRunPayload({ targetIds: [], rowIndices: [] })).toEqual({
        type: "full",
      });
    });
  });

  describe("when a target id is a blank string", () => {
    /** @scenario "A scoped run names real targets" */
    it("is refused by the payload schema", () => {
      expect(runPayloadSchema.safeParse({ targetIds: [""] }).success).toBe(false);
      expect(runPayloadSchema.safeParse({ targetIds: ["t1", ""] }).success).toBe(false);
    });

    /** @scenario "A scoped run names real targets" */
    it("keeps a payload that names a real target scoped to that target", () => {
      const parsed = runPayloadSchema.parse({ targetIds: ["t1"] });

      expect(scopeFromRunPayload(parsed)).toEqual({
        type: "target",
        targetId: "t1",
      });
    });
  });
});
