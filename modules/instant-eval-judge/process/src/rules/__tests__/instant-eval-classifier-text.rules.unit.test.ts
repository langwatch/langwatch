/**
 * What happens to a text longer than its budget, and to one the classifier refused as too large.
 * @see modules/instant-eval/specs/classifier.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  estimateTokensFromBytes,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  cutInstantEvalTextForRetry,
  prepareInstantEvalText,
} from "../instant-eval-classifier-text.rules.ts";

describe("given a text longer than its budget", () => {
  describe("when it is prepared", () => {
    /** @scenario "A text past its budget is cut rather than refused" */
    it("cuts it to the budget and says that it did", () => {
      const prepared = prepareInstantEvalText({
        text: "sentence. ".repeat(1_000),
        budgetTokens: 100,
      });

      expect(prepared.isTruncated).toBe(true);
      expect(estimateTokensFromBytes(prepared.text)).toBeLessThanOrEqual(100);
    });

    /** @scenario "A text past its budget is cut rather than refused" */
    it("keeps the opening and the ending, with a marker between them", () => {
      const prepared = prepareInstantEvalText({
        text: `User: I want a refund. ${"filler. ".repeat(1_000)}Assistant: refund issued.`,
        budgetTokens: 200,
      });

      expect(prepared.text.startsWith("User: I want a refund.")).toBe(true);
      expect(prepared.text.endsWith("Assistant: refund issued.")).toBe(true);
      expect(prepared.text).toMatch(/tokens omitted from the middle/);
    });

    /** @scenario "A text is cut at the densest ratio judged text has shown" */
    it("cuts a JSON-heavy text to the budget times the densest measured bytes per token", () => {
      const prepared = prepareInstantEvalText({ text: jsonHeavy(10_000), budgetTokens: 1_000 });

      const bytes = new TextEncoder().encode(prepared.text).length;
      expect(bytes).toBeLessThanOrEqual(
        1_000 * INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken,
      );
      expect(bytes).toBeGreaterThan(900 * INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken);
      expect(prepared.text).toMatch(/\[\.\.\. \d+ tokens omitted from the middle/);
    });

    /** @scenario "A text is cut at the densest ratio judged text has shown" */
    it("sends whole a JSON-heavy text that fits at the densest ratio", () => {
      const text = jsonHeavy(40);
      const budgetTokens = Math.ceil(
        new TextEncoder().encode(text).length /
          INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken,
      );

      expect(prepareInstantEvalText({ text, budgetTokens })).toEqual({ text, isTruncated: false });
    });

    /** @scenario "A transcript is fitted at the ratio transcripts measure" */
    it("sends whole a transcript that fits at the transcript ratio but not at the densest one", () => {
      const text = transcript(200);
      const bytes = new TextEncoder().encode(text).length;
      const budgetTokens = Math.ceil(
        bytes / INSTANT_EVAL_CLASSIFIER_LIMITS.transcriptFitBytesPerInputToken,
      );
      expect(bytes).toBeGreaterThan(
        budgetTokens * INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken,
      );

      expect(prepareInstantEvalText({ text, budgetTokens })).toEqual({ text, isTruncated: false });
    });

    /** @scenario "A transcript is fitted at the ratio transcripts measure" */
    it("cuts a longer transcript at the transcript ratio", () => {
      const prepared = prepareInstantEvalText({ text: transcript(2_000), budgetTokens: 1_000 });

      const bytes = new TextEncoder().encode(prepared.text).length;
      const ratio = INSTANT_EVAL_CLASSIFIER_LIMITS.transcriptFitBytesPerInputToken;
      expect(prepared.isTruncated).toBe(true);
      expect(bytes).toBeLessThanOrEqual(1_000 * ratio);
      expect(bytes).toBeGreaterThan(1_000 * INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken);
    });

    it("leaves a text inside its budget exactly as it was", () => {
      const prepared = prepareInstantEvalText({ text: "short enough", budgetTokens: 100 });

      expect(prepared).toEqual({ text: "short enough", isTruncated: false });
    });

    /** @scenario "An unbounded conversation past the judge's state cap is cut to the budget and marked truncated" */
    it("cuts on a character boundary rather than inside a multi-byte character", () => {
      const prepared = prepareInstantEvalText({ text: "🙂".repeat(100), budgetTokens: 10 });

      expect(prepared.isTruncated).toBe(true);
      expect(prepared.text).not.toContain("�");
    });
  });
});

describe("given a text the judge refused as too large", () => {
  describe("when it is cut for the retry", () => {
    /** @scenario "The too-large retry cuts enough for a text denser than any measured" */
    it("cuts it to the budget at a ratio below any judged text measured", () => {
      const text = `OPENING ${"filler. ".repeat(20_000)}ENDING`;

      const cut = cutInstantEvalTextForRetry({ text, budgetTokens: 1_000 });

      const bytes = new TextEncoder().encode(cut).length;
      expect(bytes).toBeLessThanOrEqual(
        1_000 * INSTANT_EVAL_CLASSIFIER_LIMITS.retryBytesPerInputToken,
      );
      expect(cut.startsWith("OPENING")).toBe(true);
      expect(cut.endsWith("ENDING")).toBe(true);
    });

    /** @scenario "A text the classifier refuses as too large is cut once and retried" */
    it("keeps at most three quarters of a text already under that", () => {
      const text = `OPENING ${"filler. ".repeat(100)}ENDING`;

      const cut = cutInstantEvalTextForRetry({ text, budgetTokens: 30_000 });

      expect(cut.length).toBeLessThanOrEqual(text.length * 0.75);
      expect(cut.endsWith("ENDING")).toBe(true);
    });
  });
});

/** A digest-like text, mostly JSON. */
function jsonHeavy(rows: number): string {
  return Array.from({ length: rows }, (_, i) =>
    JSON.stringify({ id: i, status: "ok", lines: [{ sku: `S-${i}`, qty: 1 }] }),
  ).join("\n");
}

/** A markdown transcript, mostly prose. */
function transcript(turns: number): string {
  return Array.from(
    { length: turns },
    (_, i) =>
      `## Turn ${i + 1}\n\n**User:**\n\nWhat time does activity ${i} start tomorrow?\n\n**Assistant:**\n\nActivity ${i} starts at nine at the reception.`,
  ).join("\n\n");
}
