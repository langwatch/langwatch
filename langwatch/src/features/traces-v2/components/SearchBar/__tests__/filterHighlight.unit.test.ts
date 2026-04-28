import { describe, expect, it } from "vitest";
import { buildDecorationSlots } from "../filterHighlight";

describe("buildDecorationSlots", () => {
  describe("given an empty string", () => {
    it("returns no slots", () => {
      expect(buildDecorationSlots("")).toEqual([]);
      expect(buildDecorationSlots("   ")).toEqual([]);
    });
  });

  describe("given a single tag", () => {
    it("decorates the whole field:value span as a filter-token", () => {
      const slots = buildDecorationSlots("status:error");
      expect(slots).toEqual([
        { from: 0, to: 12, className: "filter-token" },
      ]);
    });
  });

  describe("given a scenario field", () => {
    it("uses the scenario accent class", () => {
      const slots = buildDecorationSlots("scenarioVerdict:success");
      expect(slots).toEqual([
        { from: 0, to: 23, className: "filter-token filter-token-scenario" },
      ]);
    });
  });

  describe("given a NOT-prefixed tag", () => {
    it("decorates NOT as a keyword and the tag as excluded", () => {
      const slots = buildDecorationSlots("NOT status:error");
      expect(slots).toEqual([
        { from: 0, to: 3, className: "filter-keyword filter-keyword-not" },
        { from: 4, to: 16, className: "filter-token filter-token-exclude" },
      ]);
    });
  });

  describe("given a `-` shorthand negation", () => {
    it("decorates `-` as a keyword and the tag as excluded", () => {
      const slots = buildDecorationSlots("-status:error");
      expect(slots).toEqual([
        { from: 0, to: 1, className: "filter-keyword filter-keyword-not" },
        { from: 1, to: 13, className: "filter-token filter-token-exclude" },
      ]);
    });
  });

  describe("given an AND between two tags", () => {
    it("decorates each tag and the AND keyword separately", () => {
      const slots = buildDecorationSlots("status:error AND model:gpt-4o");
      expect(slots).toEqual([
        { from: 0, to: 12, className: "filter-token" },
        { from: 13, to: 16, className: "filter-keyword filter-keyword-and" },
        { from: 17, to: 29, className: "filter-token" },
      ]);
    });
  });

  describe("given an OR between two tags", () => {
    it("decorates each tag and the OR keyword separately", () => {
      const slots = buildDecorationSlots("status:error OR status:warning");
      expect(slots).toEqual([
        { from: 0, to: 12, className: "filter-token" },
        { from: 13, to: 15, className: "filter-keyword filter-keyword-or" },
        { from: 16, to: 30, className: "filter-token" },
      ]);
    });
  });

  describe("given a parenthesized group", () => {
    it("decorates both parens and the inner tags", () => {
      const slots = buildDecorationSlots("(status:error OR status:warning)");
      expect(slots).toContainEqual({
        from: 0,
        to: 1,
        className: "filter-paren",
      });
      expect(slots).toContainEqual({
        from: 31,
        to: 32,
        className: "filter-paren",
      });
    });
  });

  describe("given leading whitespace", () => {
    it("offsets locations to match the original string", () => {
      const slots = buildDecorationSlots("  status:error");
      expect(slots).toEqual([
        { from: 2, to: 14, className: "filter-token" },
      ]);
    });
  });

  describe("given an unparseable query", () => {
    it("falls back to the regex highlighter", () => {
      const slots = buildDecorationSlots("status:error AND ");
      expect(slots.some((s) => s.className.includes("filter-token"))).toBe(true);
    });
  });

  describe("given a baseOffset", () => {
    it("shifts every decoration by the offset", () => {
      const slots = buildDecorationSlots("status:error", 5);
      expect(slots).toEqual([
        { from: 5, to: 17, className: "filter-token" },
      ]);
    });
  });
});
