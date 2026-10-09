import { describe, expect, it } from "vitest";
import { cutToEstimatedTokens, estimateTokensFromBytes } from "../tokenBudget";

describe("estimateTokensFromBytes", () => {
  describe("given plain ASCII text", () => {
    it("estimates one token per four characters", () => {
      expect(estimateTokensFromBytes("a".repeat(400))).toBe(100);
    });
  });

  describe("given multi-byte text", () => {
    it("counts the bytes, not the characters", () => {
      // A character count would report this as far cheaper than it is.
      expect(estimateTokensFromBytes("🙂")).toBe(1);
      expect(estimateTokensFromBytes("漢".repeat(40))).toBe(30);
    });
  });

  describe("given the estimator the scenario judge uses", () => {
    it("agrees with it, so a digest that fits here fits there", async () => {
      const { estimateTokens } = await import("@langwatch/scenario");
      for (const sample of ["", "hello", "a".repeat(999), "🙂漢字 mixed"]) {
        expect(estimateTokensFromBytes(sample)).toBe(estimateTokens(sample));
      }
    });
  });
});

describe("cutToEstimatedTokens", () => {
  describe("given text within the budget", () => {
    it("returns it untouched", () => {
      expect(cutToEstimatedTokens({ text: "short", maxTokens: 100 })).toBe(
        "short",
      );
    });
  });

  describe("given text over the budget", () => {
    it("cuts it down to the budget", () => {
      const cut = cutToEstimatedTokens({
        text: "a".repeat(1000),
        maxTokens: 10,
      });
      expect(cut).toHaveLength(40);
      expect(estimateTokensFromBytes(cut)).toBe(10);
    });

    it("does not leave a half-decoded character at the cut", () => {
      const cut = cutToEstimatedTokens({ text: "漢漢漢漢", maxTokens: 1 });
      expect(cut).not.toContain("\uFFFD");
      expect(cut).toBe("漢");
    });

    it("keeps a replacement character the text itself carried", () => {
      // The cut drops incomplete byte sequences, not every replacement
      // character: this text really starts with one.
      const cut = cutToEstimatedTokens({ text: "\uFFFD漢", maxTokens: 1 });
      expect(cut).toBe("\uFFFD");
    });
  });
});
