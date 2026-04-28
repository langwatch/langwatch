import { describe, expect, it } from "vitest";
import { buildDecorationPlan, buildDecorationSlots } from "../filterHighlight";

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
      expect(slots).toEqual([{ from: 0, to: 12, className: "filter-token" }]);
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
      expect(slots).toEqual([{ from: 2, to: 14, className: "filter-token" }]);
    });
  });

  describe("given an unparseable query", () => {
    it("falls back to the regex highlighter", () => {
      const slots = buildDecorationSlots("status:error AND ");
      expect(slots.some((s) => s.className.includes("filter-token"))).toBe(
        true,
      );
    });
  });

  describe("given a baseOffset", () => {
    it("shifts every decoration by the offset", () => {
      const slots = buildDecorationSlots("status:error", 5);
      expect(slots).toEqual([{ from: 5, to: 17, className: "filter-token" }]);
    });
  });
});

describe("buildDecorationPlan — wildcard + boolean cases", () => {
  describe("given a wildcard value followed by AND and another tag", () => {
    it("emits two tag tokens with the AND keyword between them — never one merged token", () => {
      const text = "model:gpt-* AND status:error";
      const plan = buildDecorationPlan(text);

      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        { from: 0, to: 11, className: "filter-token" },
        { from: 16, to: 28, className: "filter-token" },
      ]);

      // AND keyword is its own decoration, not glued to either tag.
      expect(plan.slots).toContainEqual({
        from: 12,
        to: 15,
        className: "filter-keyword filter-keyword-and",
      });

      // Two tag widgets, one per tag.
      expect(plan.tokens).toEqual([
        { start: 0, end: 11, field: "model", value: "gpt-*" },
        { start: 16, end: 28, field: "status", value: "error" },
      ]);
    });
  });

  describe("given a single wildcard value", () => {
    it("decorates only the field:value span — the `*` is part of the value", () => {
      const plan = buildDecorationPlan("model:gpt-*");
      expect(plan.slots).toEqual([
        { from: 0, to: 11, className: "filter-token" },
      ]);
      expect(plan.tokens).toEqual([
        { start: 0, end: 11, field: "model", value: "gpt-*" },
      ]);
    });
  });

  describe("given an OR between two wildcard tags", () => {
    it("emits two tag tokens and the OR keyword separately", () => {
      const plan = buildDecorationPlan("model:gpt-* OR model:claude-*");
      const tokens = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokens).toHaveLength(2);
      expect(plan.slots).toContainEqual({
        from: 12,
        to: 14,
        className: "filter-keyword filter-keyword-or",
      });
    });
  });

  describe("given an incomplete `<tag> AND` (no right operand)", () => {
    it("falls back to the regex highlighter and only decorates the parseable left tag", () => {
      const plan = buildDecorationPlan("model:gpt-* AND");
      // Liqe parse fails for incomplete AND. The regex fallback only matches
      // the field:value span and leaves the dangling AND unstyled.
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        { from: 0, to: 11, className: "filter-token" },
      ]);
      // No AND keyword decoration — the parser couldn't confirm it as one.
      expect(
        plan.slots.some((s) => s.className.includes("filter-keyword-and")),
      ).toBe(false);
      // No widget tokens emitted by the regex fallback.
      expect(plan.tokens).toEqual([]);
    });
  });

  describe("given an unquoted value followed immediately by AND with no space", () => {
    it("parses as one Tag whose value contains the literal `AND` — liqe doesn't strip operator-shaped substrings from inside unquoted values", () => {
      // This is the silent-failure mode: if the user's space gets eaten,
      // `model:gpt-*AND` round-trips to a Tag with value `gpt-*AND`, no
      // AND keyword recognised. The test pins that behaviour so a future
      // regression that DOES strip the space would show up loudly.
      const plan = buildDecorationPlan("model:gpt-*AND");
      const tokenSlots = plan.slots.filter((s) =>
        s.className.includes("filter-token"),
      );
      expect(tokenSlots).toEqual([
        { from: 0, to: 14, className: "filter-token" },
      ]);
      expect(plan.tokens).toEqual([
        { start: 0, end: 14, field: "model", value: "gpt-*AND" },
      ]);
      // No AND keyword decoration — there is no boolean operator in the AST.
      expect(
        plan.slots.some((s) => s.className.includes("filter-keyword-and")),
      ).toBe(false);
    });
  });
});
