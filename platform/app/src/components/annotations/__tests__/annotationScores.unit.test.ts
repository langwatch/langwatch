/**
 * The scores one reviewer gave, as a row reads them.
 * See specs/traces-v2/trace-list-annotations-column.feature.
 */
import type { Annotation } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  annotationScores,
  annotationScoresLine,
  countAnnotationScores,
} from "../annotationRow";

const SCORE_NAMES = new Map([
  ["score-abc123", "goodness"],
  ["score-def456", "helpfulness"],
]);

/** An annotation carrying only the scores a case is about. */
const scored = (scoreOptions: unknown): Pick<Annotation, "scoreOptions"> =>
  ({ scoreOptions }) as Pick<Annotation, "scoreOptions">;

describe("given a reviewer scored a trace", () => {
  describe("when the row reads their scores", () => {
    /** @scenario "A score reads by its name, not by its id" */
    it("names the score the way the project names it", () => {
      const line = annotationScoresLine({
        annotation: scored({
          "score-abc123": { value: "mild", reason: "not enough detail" },
        }),
        scoreNamesById: SCORE_NAMES,
      });

      expect(line).toBe("goodness: mild (not enough detail)");
      expect(line).not.toContain("score-abc123");
    });

    it("names a score by its id when the project no longer has it", () => {
      expect(
        annotationScoresLine({
          annotation: scored({ "score-removed": { value: "mild" } }),
          scoreNamesById: SCORE_NAMES,
        }),
      ).toBe("score-removed: mild");
    });

    it("joins the answers of a score that takes several", () => {
      expect(
        annotationScoresLine({
          annotation: scored({
            "score-abc123": { value: ["mild", "vague"], reason: null },
          }),
          scoreNamesById: SCORE_NAMES,
        }),
      ).toBe("goodness: mild, vague");
    });

    it("reads every score they gave on one line", () => {
      expect(
        annotationScoresLine({
          annotation: scored({
            "score-abc123": { value: "mild", reason: null },
            "score-def456": { value: "4", reason: null },
          }),
          scoreNamesById: SCORE_NAMES,
        }),
      ).toBe("goodness: mild · helpfulness: 4");
    });
  });
});

describe("given a reviewer who scored nothing", () => {
  describe("when the row reads their scores", () => {
    /** @scenario "A score a reviewer left blank is not a score they gave" */
    it("leaves out a score key they opened and answered nothing on", () => {
      const annotation = scored({
        "score-abc123": { value: null, reason: null },
        "score-def456": { value: "", reason: null },
      });

      expect(annotationScores({ annotation })).toEqual([]);
      expect(annotationScoresLine({ annotation })).toBeNull();
    });

    it("reads no scores from an annotation that carries none at all", () => {
      expect(annotationScores({ annotation: scored(null) })).toEqual([]);
      expect(annotationScoresLine({ annotation: scored(null) })).toBeNull();
    });
  });
});

describe("given a trace several reviewers scored", () => {
  describe("when the row counts the scores", () => {
    /** @scenario "A scored trace counts the scores given, not the reviews that gave them" */
    it("counts the scores rather than the reviewers who gave them", () => {
      const annotations = [
        scored({
          "score-abc123": { value: "mild" },
          "score-def456": { value: "4" },
        }),
        scored({ "score-abc123": { value: "strong" } }),
      ];

      expect(countAnnotationScores(annotations)).toBe(3);
    });

    it("counts nothing on a trace nobody scored", () => {
      expect(countAnnotationScores([scored(null), scored({})])).toBe(0);
    });
  });
});
