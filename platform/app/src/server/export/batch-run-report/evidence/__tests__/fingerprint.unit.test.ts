import { describe, expect, it } from "vitest";
import {
  criterionIdFor,
  normalizeCriterion,
  normalizeErrorShape,
  signatureIdFor,
} from "../fingerprint";

/**
 * Identity rules for the things a run report talks about.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

describe("normalizeCriterion()", () => {
  describe("given text that is already normalised", () => {
    it("returns it unchanged", () => {
      expect(normalizeCriterion("offers a refund")).toBe("offers a refund");
    });

    it("stays put when applied twice", () => {
      const once = normalizeCriterion("  Offers   A\tRefund \n");
      expect(normalizeCriterion(once)).toBe(once);
    });
  });

  describe("given text that differs only in whitespace and case", () => {
    it("collapses runs of whitespace to a single space", () => {
      expect(normalizeCriterion("offers   a\n\trefund")).toBe(
        "offers a refund",
      );
    });

    it("lowercases and trims", () => {
      expect(normalizeCriterion("  Offers A Refund  ")).toBe("offers a refund");
    });
  });
});

describe("criterionIdFor()", () => {
  describe("given the same criterion written differently", () => {
    const canonical = criterionIdFor({
      scenarioId: "scenario_a",
      text: "offers a refund",
    });

    it("gives the same id despite whitespace differences", () => {
      expect(
        criterionIdFor({
          scenarioId: "scenario_a",
          text: "  offers   a  refund ",
        }),
      ).toBe(canonical);
    });

    it("gives the same id despite case differences", () => {
      expect(
        criterionIdFor({ scenarioId: "scenario_a", text: "Offers A Refund" }),
      ).toBe(canonical);
    });
  });

  describe("given the same criterion text under different scenarios", () => {
    /** @scenario A criterion never seen before is not called a regression */
    it("gives different ids so no trend is invented across them", () => {
      const inA = criterionIdFor({
        scenarioId: "scenario_a",
        text: "responds in English",
      });
      const inB = criterionIdFor({
        scenarioId: "scenario_b",
        text: "responds in English",
      });
      expect(inA).not.toBe(inB);
    });
  });

  describe("given different criteria in one scenario", () => {
    it("gives different ids", () => {
      const first = criterionIdFor({
        scenarioId: "scenario_a",
        text: "offers a refund",
      });
      const second = criterionIdFor({
        scenarioId: "scenario_a",
        text: "stays polite",
      });
      expect(first).not.toBe(second);
    });
  });
});

describe("normalizeErrorShape()", () => {
  const firstOccurrence =
    'Request to https://api.example.com/v1/thing failed for id 9f8e7d6c5b4a3210 with "boom" after 3 retries';
  const secondOccurrence =
    'Request to https://api.other.io/v2/x failed for id aabbccdd11223344 with "kaboom" after 12 retries';

  describe("given two instances of one recurring error", () => {
    /** @scenario Failures are grouped by what went wrong */
    it("reduces both to the same shape", () => {
      expect(normalizeErrorShape(firstOccurrence)).toBe(
        normalizeErrorShape(secondOccurrence),
      );
    });

    it("replaces the parts that differ per occurrence", () => {
      expect(normalizeErrorShape(firstOccurrence)).toBe(
        'Request to <url> failed for id <id> with "<value>" after <n> retries',
      );
    });
  });

  describe("given values embedded in single quotes", () => {
    it("collapses them too", () => {
      expect(normalizeErrorShape("model 'gpt-a' is unavailable")).toBe(
        "model '<value>' is unavailable",
      );
    });
  });

  describe("given errors of different kinds", () => {
    /** @scenario Infrastructure errors are separated from judged failures */
    it("keeps their shapes apart", () => {
      expect(normalizeErrorShape("Timeout after 30000 ms")).not.toBe(
        normalizeErrorShape("Connection refused by upstream"),
      );
    });
  });

  describe("given a very long error", () => {
    it("caps the shape so one message cannot dominate an id", () => {
      expect(normalizeErrorShape("x".repeat(500))).toHaveLength(200);
    });
  });
});

describe("signatureIdFor()", () => {
  const unmetCriteria = ["stays polite", "answers the question"];

  describe("given the same criteria under different kinds", () => {
    /** @scenario Infrastructure errors are separated from judged failures */
    it("gives different ids so a judged failure never joins an error", () => {
      const judged = signatureIdFor({
        kind: "judged",
        unmetCriteria,
        errorShape: null,
      });
      const errored = signatureIdFor({
        kind: "errored",
        unmetCriteria,
        errorShape: null,
      });
      expect(judged).not.toBe(errored);
    });
  });

  describe("given the same criteria listed in a different order", () => {
    /** @scenario Failures are grouped by what went wrong */
    it("gives the same id", () => {
      expect(
        signatureIdFor({
          kind: "judged",
          unmetCriteria: ["answers the question", "stays polite"],
          errorShape: null,
        }),
      ).toBe(
        signatureIdFor({ kind: "judged", unmetCriteria, errorShape: null }),
      );
    });
  });

  describe("given the same kind with different error shapes", () => {
    it("gives different ids", () => {
      const refused = signatureIdFor({
        kind: "errored",
        unmetCriteria: [],
        errorShape: "Connection refused",
      });
      const timedOut = signatureIdFor({
        kind: "errored",
        unmetCriteria: [],
        errorShape: "Timeout after <n> ms",
      });
      expect(refused).not.toBe(timedOut);
    });
  });
});
