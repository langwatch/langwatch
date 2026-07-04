import { describe, expect, it } from "vitest";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  InputCategory,
  OutputCategory,
} from "~/server/app-layer/traces/block-classification/categories";
import {
  spanContentBreakdownRows,
  traceContentBreakdownRows,
} from "../contentBreakdown";

describe("traceContentBreakdownRows", () => {
  describe("given trace attributes carrying reserved blockcat totals", () => {
    it("derives one row per non-zero category, sorted by cost, with shares", () => {
      const attributes: Record<string, string> = {
        [blockCategoryTokensAttr(InputCategory.SYSTEM_PROMPT)]: "3997",
        [blockCategoryCostAttr(InputCategory.SYSTEM_PROMPT)]: "0.02",
        [blockCategoryTokensAttr(InputCategory.SKILL_CONTENT)]: "279",
        [blockCategoryCostAttr(InputCategory.SKILL_CONTENT)]: "0.0013953165",
        [blockCategoryTokensAttr(OutputCategory.ASSISTANT_TEXT)]: "36",
        [blockCategoryCostAttr(OutputCategory.ASSISTANT_TEXT)]: "0.001",
      };

      const rows = traceContentBreakdownRows(attributes);

      // Sorted by cost desc: system ($0.02) > skill ($0.00139) > assistant
      // ($0.001). Skill content is present — the exact lane the codex trace was
      // missing from the waterfall.
      expect(rows.map((r) => r.category)).toEqual([
        InputCategory.SYSTEM_PROMPT,
        InputCategory.SKILL_CONTENT,
        OutputCategory.ASSISTANT_TEXT,
      ]);
      const skill = rows.find(
        (r) => r.category === InputCategory.SKILL_CONTENT,
      );
      expect(skill?.tokens).toBe(279);
      expect(skill?.label).toBe("Skill content");
      // Shares sum to ~100 across the priced lanes.
      const shareSum = rows.reduce((s, r) => s + r.sharePct, 0);
      expect(shareSum).toBeCloseTo(100, 5);
    });

    it("keeps a tokens-only lane from an unpriced model (cost 0, tokens > 0)", () => {
      const attributes: Record<string, string> = {
        [blockCategoryTokensAttr(InputCategory.SYSTEM_PROMPT)]: "500",
        [blockCategoryCostAttr(InputCategory.SYSTEM_PROMPT)]: "0",
      };

      const rows = traceContentBreakdownRows(attributes);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokens).toBe(500);
      expect(rows[0]?.costUsd).toBe(0);
    });
  });

  describe("given a trace with no classified content", () => {
    it("returns an empty array (so the section is not rendered)", () => {
      expect(traceContentBreakdownRows({})).toEqual([]);
      expect(traceContentBreakdownRows(undefined)).toEqual([]);
      expect(traceContentBreakdownRows(null)).toEqual([]);
      // Non-blockcat attributes never leak into the breakdown.
      expect(
        traceContentBreakdownRows({ "gen_ai.usage.input_tokens": "1000" }),
      ).toEqual([]);
    });
  });
});

describe("spanContentBreakdownRows", () => {
  describe("given a span's unflattened params carrying nested blockcat", () => {
    it("reads the nested langwatch.reserved.blockcat totals into rows", () => {
      // The span mapper unflattens dotted attribute keys, so blockcat lands at
      // params.langwatch.reserved.blockcat.<category>.{tokens,cost_usd}.
      const params = {
        langwatch: {
          reserved: {
            blockcat: {
              [InputCategory.SYSTEM_PROMPT]: {
                tokens: "3997",
                cost_usd: "0.02",
              },
              [InputCategory.SKILL_CONTENT]: {
                tokens: "279",
                cost_usd: "0.0013953165",
              },
            },
          },
        },
        // A sibling attribute that must not be mistaken for a category.
        "gen_ai.usage.input_tokens": "4408",
      };

      const rows = spanContentBreakdownRows(params);

      expect(rows.map((r) => r.category)).toEqual([
        InputCategory.SYSTEM_PROMPT,
        InputCategory.SKILL_CONTENT,
      ]);
      const skill = rows.find(
        (r) => r.category === InputCategory.SKILL_CONTENT,
      );
      expect(skill?.tokens).toBe(279);
      expect(skill?.label).toBe("Skill content");
    });
  });

  describe("given a span with no classified content", () => {
    it("returns an empty array", () => {
      expect(spanContentBreakdownRows(undefined)).toEqual([]);
      expect(spanContentBreakdownRows(null)).toEqual([]);
      expect(spanContentBreakdownRows({})).toEqual([]);
      expect(spanContentBreakdownRows({ langwatch: { reserved: {} } })).toEqual(
        [],
      );
    });
  });
});
