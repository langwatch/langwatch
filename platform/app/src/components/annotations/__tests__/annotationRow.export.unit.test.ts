/**
 * CSV export labels for annotation ratings (#6835 item 3).
 *
 * `isThumbsUp` is tri-state: the drawer's comment flow never sends it and the
 * router stores null, so a comment-only annotation carries no verdict. The
 * export is used as labelled ground truth — fabricating "Thumbs Down" for a
 * null poisons every downstream consumer with a negative verdict nobody gave.
 */
import { describe, expect, it } from "vitest";
import { annotationRatingExportLabel } from "../annotationRow";

describe("annotationRatingExportLabel", () => {
  describe("when the annotation carries an explicit rating", () => {
    it("labels true as Thumbs Up", () => {
      expect(annotationRatingExportLabel(true)).toBe("Thumbs Up");
    });

    it("labels false as Thumbs Down", () => {
      expect(annotationRatingExportLabel(false)).toBe("Thumbs Down");
    });
  });

  describe("when the annotation is comment-only (no rating)", () => {
    it("exports an empty cell for null, never a fabricated Thumbs Down", () => {
      expect(annotationRatingExportLabel(null)).toBe("");
    });

    it("exports an empty cell for undefined", () => {
      expect(annotationRatingExportLabel(undefined)).toBe("");
    });
  });
});
