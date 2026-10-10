/**
 * The token estimate and the cut that keeps a digest under a model's budget.
 * Spec: specs/traces/trace-extraction-modules.feature.
 */
import { describe, expect, it } from "vitest";

import {
  cutToEstimatedTokens,
  cutToEstimatedTokensAtLineBreak,
  cutToEstimatedTokensKeepingEnds,
  estimateTokensFromBytes,
} from "../trace-token-budget.ts";

describe("estimateTokensFromBytes", () => {
  describe("given plain ASCII text", () => {
    /** @scenario "The token estimate counts bytes, not characters" */
    it("estimates one token per four characters", () => {
      expect(estimateTokensFromBytes("a".repeat(400))).toBe(100);
    });
  });

  describe("given multi-byte text", () => {
    /** @scenario "The token estimate counts bytes, not characters" */
    it("counts the bytes, not the characters", () => {
      // A character count would report this as far cheaper than it is.
      expect(estimateTokensFromBytes("🙂")).toBe(1);
      expect(estimateTokensFromBytes("漢".repeat(40))).toBe(30);
    });
  });
});

describe("cutToEstimatedTokens", () => {
  describe("given text within the budget", () => {
    it("returns it untouched", () => {
      expect(cutToEstimatedTokens({ text: "short", maxTokens: 100 })).toBe("short");
    });
  });

  describe("given text over the budget", () => {
    it("cuts it down to the budget", () => {
      const cut = cutToEstimatedTokens({ text: "a".repeat(1000), maxTokens: 10 });

      expect(cut).toHaveLength(40);
      expect(estimateTokensFromBytes(cut)).toBe(10);
    });

    /** @scenario "A cut never leaves half a character behind" */
    it("does not leave a half-decoded character at the cut", () => {
      const cut = cutToEstimatedTokens({ text: "漢漢漢漢", maxTokens: 1 });

      expect(cut).not.toContain("�");
      expect(cut).toBe("漢");
    });

    it("keeps a replacement character the text itself carried", () => {
      // The cut drops incomplete byte sequences, not every replacement
      // character: this text really starts with one.
      expect(cutToEstimatedTokens({ text: "�漢", maxTokens: 1 })).toBe("�");
    });
  });
});

describe("cutToEstimatedTokensAtLineBreak", () => {
  describe("given a line-oriented digest over the budget", () => {
    /** @scenario "A line-oriented digest is cut on a line break" */
    it("cuts back to the last whole line", () => {
      const text = ["first line", "second line", "third line"].join("\n");

      const cut = cutToEstimatedTokensAtLineBreak({ text, maxTokens: 5 });

      expect(cut).toBe("first line");
    });
  });

  describe("given a first line already over the budget", () => {
    it("cuts where the budget ends, because there is no break to move back to", () => {
      const cut = cutToEstimatedTokensAtLineBreak({ text: "a".repeat(100), maxTokens: 5 });

      expect(cut).toHaveLength(20);
    });
  });
});

describe("cutToEstimatedTokensKeepingEnds", () => {
  const text = `OPENING ${"middle ".repeat(2_000)}ENDING`;

  describe("given text within the budget", () => {
    it("returns it untouched", () => {
      expect(cutToEstimatedTokensKeepingEnds({ text: "short", maxTokens: 100 })).toBe("short");
    });
  });

  describe("given text over the budget", () => {
    /** @scenario "A text cut for a judge keeps its opening and its ending" */
    it("keeps the opening and the ending with a marker naming what was left out", () => {
      const cut = cutToEstimatedTokensKeepingEnds({ text, maxTokens: 200 });

      expect(estimateTokensFromBytes(cut)).toBeLessThanOrEqual(200);
      expect(cut.startsWith("OPENING")).toBe(true);
      expect(cut.endsWith("ENDING")).toBe(true);
      const omitted = Number(/\[\.\.\. (\d+) tokens omitted/.exec(cut)?.[1]);
      expect(omitted).toBeGreaterThan(estimateTokensFromBytes(text) - 200);
    });

    /** @scenario "A text cut for a judge keeps its opening and its ending" */
    it("does not leave a half-decoded character at either end", () => {
      const cut = cutToEstimatedTokensKeepingEnds({ text: "漢".repeat(1_000), maxTokens: 101 });

      expect(cut).not.toContain("\uFFFD");
      expect(estimateTokensFromBytes(cut)).toBeLessThanOrEqual(101);
    });

    /** @scenario "A text cut for a judge keeps its opening and its ending" */
    it("keeps whole lines when asked to", () => {
      const lines = Array.from({ length: 400 }, (_, i) => `line number ${i}`).join("\n");

      const cut = cutToEstimatedTokensKeepingEnds({
        text: lines,
        maxTokens: 150,
        atLineBreak: true,
      });

      const kept = cut.split("\n").filter((line) => line && !line.startsWith("[..."));
      expect(kept.every((line) => /^line number \d+$/.test(line))).toBe(true);
      expect(kept[0]).toBe("line number 0");
      expect(kept.at(-1)).toBe("line number 399");
    });
  });

  describe("given a budget too small to keep two readable ends", () => {
    it("falls back to cutting the head", () => {
      expect(cutToEstimatedTokensKeepingEnds({ text, maxTokens: 20 })).toBe(
        cutToEstimatedTokens({ text, maxTokens: 20 }),
      );
    });
  });
});
