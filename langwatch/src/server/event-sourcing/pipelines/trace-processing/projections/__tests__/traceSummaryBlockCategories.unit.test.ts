import { describe, expect, it } from "vitest";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  InputCategory,
} from "~/server/app-layer/traces/block-classification/categories";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

const SYS_TOKENS = blockCategoryTokensAttr(InputCategory.SYSTEM_PROMPT);
const SYS_COST = blockCategoryCostAttr(InputCategory.SYSTEM_PROMPT);

describe("applySpanToSummary block-category accumulation", () => {
  describe("given a span carrying per-category block totals", () => {
    describe("when it is folded into the trace summary", () => {
      it("rolls the category tokens and cost into trace-level reserved sums", () => {
        const span = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "claude-sonnet-4",
            "gen_ai.usage.input_tokens": 300,
            [SYS_TOKENS]: "100",
            [SYS_COST]: "0.0003",
          },
        });

        const state = applySpanToSummary({ state: createInitState(), span });

        expect(state.attributes[SYS_TOKENS]).toBe("100");
        expect(state.attributes[SYS_COST]).toBe("0.0003");
      });
    });
  });

  describe("given two spans each carrying the same category", () => {
    describe("when both are folded", () => {
      it("accumulates the category tokens and cost across spans", () => {
        const makeSpan = (tokens: string, cost: string) =>
          createTestSpan({
            spanAttributes: {
              "gen_ai.request.model": "claude-sonnet-4",
              "gen_ai.usage.input_tokens": 300,
              [SYS_TOKENS]: tokens,
              [SYS_COST]: cost,
            },
          });

        let state = createInitState();
        state = applySpanToSummary({ state, span: makeSpan("100", "0.001") });
        state = applySpanToSummary({ state, span: makeSpan("50", "0.0005") });

        expect(state.attributes[SYS_TOKENS]).toBe("150");
        expect(Number(state.attributes[SYS_COST])).toBeCloseTo(0.0015, 9);
      });
    });
  });

  describe("given a span flagged as a redundant usage copy", () => {
    describe("when it also carries block-category totals", () => {
      it("excludes its category totals from the trace sums (no double-count)", () => {
        const turnSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "claude-sonnet-4",
            "gen_ai.usage.input_tokens": 300,
            [SYS_TOKENS]: "100",
            [SYS_COST]: "0.001",
          },
        });
        const redundantSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.usage.input_tokens": 300,
            "langwatch.reserved.skip_token_accumulation": "true",
            [SYS_TOKENS]: "100",
            [SYS_COST]: "0.001",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: turnSpan });
        state = applySpanToSummary({ state, span: redundantSpan });

        // Counted once — the redundant copy's category totals are skipped.
        expect(state.attributes[SYS_TOKENS]).toBe("100");
        expect(state.attributes[SYS_COST]).toBe("0.001");
      });
    });
  });
});
