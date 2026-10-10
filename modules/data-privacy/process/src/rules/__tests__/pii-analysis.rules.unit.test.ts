import { describe, expect, it } from "vitest";

import { redactSparingNamesAndPlaces } from "../pii-analysis.rules.ts";

const PHONE = { entity_type: "PHONE_NUMBER", start: 18, end: 29, score: 0.75 };

describe("redactSparingNamesAndPlaces", () => {
  describe("given only name and place findings", () => {
    it("leaves the text unchanged", () => {
      expect(
        redactSparingNamesAndPlaces({
          text: "claude-sonnet-4-6",
          findings: [
            { entity_type: "PERSON", start: 0, end: 6, score: 0.85 },
            { entity_type: "LOCATION", start: 7, end: 13, score: 0.6 },
          ],
        }),
      ).toEqual({ kind: "unchanged" });
    });
  });

  describe("given two overlapping non-name findings", () => {
    /** @scenario "Overlapping findings in a model name are redacted as one span" */
    it("replaces the whole overlapping span with one marker", () => {
      const result = redactSparingNamesAndPlaces({
        text: "id-4111111111111111-x",
        findings: [
          { entity_type: "US_BANK_NUMBER", start: 3, end: 15, score: 0.5 },
          { entity_type: "CREDIT_CARD", start: 3, end: 19, score: 1 },
        ],
      });

      expect(result).toEqual({ kind: "redacted", text: "id-[CREDIT_CARD]-x" });
    });

    it("never leaves the tail of a partial overlap readable", () => {
      const result = redactSparingNamesAndPlaces({
        text: "a-1234567890-b",
        findings: [
          { entity_type: "PHONE_NUMBER", start: 2, end: 8, score: 0.9 },
          { entity_type: "US_BANK_NUMBER", start: 5, end: 12, score: 0.5 },
        ],
      });

      expect(result).toEqual({ kind: "redacted", text: "a-[PHONE_NUMBER]-b" });
    });
  });

  describe("given a text the analysis service would have rewritten first", () => {
    it.each([
      ["surrounding whitespace", " claude-sonnet-4-6"],
      ["an escape the JSON unfolding would change", "model\\n4"],
      ["a character outside the BMP", "model-\u{1F600}"],
    ])("cannot place the findings when it has %s", (_why, text) => {
      expect(redactSparingNamesAndPlaces({ text, findings: [PHONE] })).toEqual({
        kind: "unplaceable",
      });
    });
  });

  describe("given findings that are not in the expected shape", () => {
    it.each([
      ["missing", undefined],
      ["not a list", { start: 0 }],
      ["missing a position", [{ entity_type: "PHONE_NUMBER", score: 1 }]],
    ])("cannot place them when they are %s", (_why, findings) => {
      expect(redactSparingNamesAndPlaces({ text: "claude-sonnet-4-6", findings })).toEqual({
        kind: "unplaceable",
      });
    });
  });
});
