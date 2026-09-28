import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: { LANGEVALS_ENDPOINT: "http://test-langevals" },
}));

vi.mock("~/server/metrics", () => ({
  getPiiChecksCounter: () => ({ inc: () => undefined }),
  getEvaluationStatusCounter: () => ({ inc: () => undefined }),
  evaluationDurationHistogram: { labels: () => ({ observe: () => undefined }) },
}));

import { batchPresidioClearPII, redactSparingNamesAndPlaces } from "./piiCheck";

type Finding = {
  entity_type: string;
  start: number;
  end: number;
  score: number;
};

/** Answer the batch request with one processed result per given response. */
function presidioAnswers(
  responses: { anonymized: string; results?: Finding[] }[],
) {
  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
    async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () =>
          responses.map((raw_response) => ({
            status: "processed",
            raw_response,
          })),
      }) as unknown as Response,
  );
  return fetchSpy;
}

const MODEL_WITH_PHONE = "claude-sonnet-4-6+12345678901";
const PERSON: Finding = {
  entity_type: "PERSON",
  start: 0,
  end: 6,
  score: 0.85,
};
const PHONE: Finding = {
  entity_type: "PHONE_NUMBER",
  start: 18,
  end: 29,
  score: 0.75,
};

describe("batchPresidioClearPII sparing names and places", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given one flagged and one unflagged text", () => {
    it("sends both in a single request", async () => {
      const fetchSpy = presidioAnswers([
        { anonymized: "<PERSON>-sonnet-4-6", results: [PERSON] },
        { anonymized: "<PERSON> called", results: [] },
      ]);

      await batchPresidioClearPII(
        ["claude-sonnet-4-6", "Jane called"],
        "STRICT",
        { spareNamesAndPlaces: [true, false] },
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("drops the name finding on the flagged text only", async () => {
      presidioAnswers([
        { anonymized: "<PERSON>-sonnet-4-6", results: [PERSON] },
        { anonymized: "<PERSON> called", results: [PERSON] },
      ]);

      const results = await batchPresidioClearPII(
        ["claude-sonnet-4-6", "Jane called"],
        "STRICT",
        { spareNamesAndPlaces: [true, false] },
      );

      expect(results).toEqual([null, "[PERSON] called"]);
    });
  });

  /** @scenario "A name found in a model name is dropped while a phone number beside it is redacted" */
  describe("given a flagged text with a person and a phone number", () => {
    it("replaces only the phone number with its marker", async () => {
      presidioAnswers([
        {
          anonymized: "<PERSON>-sonnet-4-6+<PHONE_NUMBER>",
          results: [PERSON, PHONE],
        },
      ]);

      const [result] = await batchPresidioClearPII(
        [MODEL_WITH_PHONE],
        "STRICT",
        { spareNamesAndPlaces: [true] },
      );

      expect(result).toBe("claude-sonnet-4-6+[PHONE_NUMBER]");
    });
  });

  /** @scenario "A model name whose findings cannot be placed keeps the full redaction" */
  describe("given a flagged text but no finding positions in the response", () => {
    it("keeps the analysis service's own redaction, names included", async () => {
      presidioAnswers([{ anonymized: "<PERSON>-sonnet-4-6" }]);

      const [result] = await batchPresidioClearPII(
        ["claude-sonnet-4-6"],
        "STRICT",
        { spareNamesAndPlaces: [true] },
      );

      expect(result).toBe("[PERSON]-sonnet-4-6");
    });
  });
});

describe("redactSparingNamesAndPlaces", () => {
  describe("given only name and place findings", () => {
    it("returns null, leaving the text unchanged", () => {
      expect(
        redactSparingNamesAndPlaces("claude-sonnet-4-6", [
          PERSON,
          { entity_type: "LOCATION", start: 7, end: 13, score: 0.6 },
        ]),
      ).toBeNull();
    });
  });

  /** @scenario "Overlapping findings in a model name are redacted as one span" */
  describe("given two overlapping non-name findings", () => {
    it("replaces the whole overlapping span with one marker", () => {
      const text = "id-4111111111111111-x";
      const result = redactSparingNamesAndPlaces(text, [
        { entity_type: "US_BANK_NUMBER", start: 3, end: 15, score: 0.4 },
        { entity_type: "CREDIT_CARD", start: 3, end: 19, score: 1 },
      ]);

      expect(result).toBe("id-[CREDIT_CARD]-x");
    });

    it("never leaves the tail of a partial overlap readable", () => {
      const result = redactSparingNamesAndPlaces("a-1234567890-b", [
        { entity_type: "PHONE_NUMBER", start: 2, end: 8, score: 0.9 },
        { entity_type: "US_BANK_NUMBER", start: 5, end: 12, score: 0.5 },
      ]);

      expect(result).toBe("a-[PHONE_NUMBER]-b");
    });
  });

  describe("given a text the analysis service would have rewritten first", () => {
    it.each([
      ["surrounding whitespace", " claude-sonnet-4-6"],
      ["an escape the JSON unfolding would change", "model\\n4"],
      ["a character outside the BMP", "model-\u{1F600}"],
    ])("cannot place the findings when it has %s", (_why, text) => {
      expect(redactSparingNamesAndPlaces(text, [PHONE])).toBeUndefined();
    });
  });

  describe("given findings that are not in the expected shape", () => {
    it.each([
      ["missing", undefined],
      ["not a list", { start: 0 }],
      ["missing a position", [{ entity_type: "PHONE_NUMBER", score: 1 }]],
    ])("cannot place them when they are %s", (_why, findings) => {
      expect(
        redactSparingNamesAndPlaces("claude-sonnet-4-6", findings),
      ).toBeUndefined();
    });
  });
});
