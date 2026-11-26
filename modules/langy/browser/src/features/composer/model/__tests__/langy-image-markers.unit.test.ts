/**
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import { describe, expect, it } from "vitest";

import {
  insertMarkers,
  markerDeletion,
  markerLabelFor,
  markerRangesIn,
  markersMissingFrom,
  pastedNameFor,
  snapCaret,
  textPiecesOf,
  withoutMarker,
} from "../langy-image-markers.ts";

describe("langy image markers", () => {
  describe("given the composer holds 'look at  please' with the caret after 'at '", () => {
    /** @scenario A pasted image becomes an inline chip at the caret */
    it("puts a pasted-<hex>.png chip where the caret was, spaced from the words", () => {
      const fileName = pastedNameFor({
        fileName: "image.png",
        mediaType: "image/png",
        randomHex: () => "1a2b3c",
      });
      const label = markerLabelFor({ fileName, taken: [] });

      const next = insertMarkers({ text: "look at  please", start: 8, end: 8, labels: [label] });

      expect(label).toBe("[▣ pasted-1a2b3c.png]");
      expect(next.text).toBe("look at [▣ pasted-1a2b3c.png] please");
      expect(next.caret).toBe("look at [▣ pasted-1a2b3c.png]".length);
    });

    /** @scenario A pasted image becomes an inline chip at the caret */
    it("keeps an image's own name and makes a second one with that name unique", () => {
      expect(
        pastedNameFor({ fileName: "chart.png", mediaType: "image/png", randomHex: () => "x" }),
      ).toBe("chart.png");
      expect(markerLabelFor({ fileName: "chart.png", taken: ["[▣ chart.png]"] })).toBe(
        "[▣ chart (2).png]",
      );
    });

    /** @scenario A pasted image becomes an inline chip at the caret */
    it("spaces a chip put straight after a word", () => {
      expect(insertMarkers({ text: "see", start: 3, end: 3, labels: ["[▣ a.png]"] }).text).toBe(
        "see [▣ a.png] ",
      );
    });
  });

  describe("given the composer text holds an image chip", () => {
    const text = "see [▣ a.png] now";
    const ranges = markerRangesIn({ text, markers: [{ key: "a", label: "[▣ a.png]" }] });

    /** @scenario Backspace after an image chip removes the whole chip */
    it("removes the whole chip on Backspace right after it", () => {
      expect(markerDeletion({ text, ranges, start: 13, end: 13, key: "Backspace" })).toEqual({
        text: "see  now",
        caret: 4,
      });
    });

    /** @scenario Backspace after an image chip removes the whole chip */
    it("removes the whole chip on Delete right before it, and leaves other keys alone", () => {
      expect(markerDeletion({ text, ranges, start: 4, end: 4, key: "Delete" })?.text).toBe(
        "see  now",
      );
      expect(markerDeletion({ text, ranges, start: 2, end: 2, key: "Backspace" })).toBeUndefined();
      expect(markerDeletion({ text, ranges, start: 4, end: 13, key: "Backspace" })).toBeUndefined();
    });

    /** @scenario Backspace after an image chip removes the whole chip */
    it("never rests the caret inside a chip", () => {
      expect(snapCaret({ ranges, caret: 6 })).toBe(4);
      expect(snapCaret({ ranges, caret: 12 })).toBe(13);
      expect(snapCaret({ ranges, caret: 2 })).toBe(2);
    });

    it("splits the text around its chips for drawing", () => {
      expect(textPiecesOf({ text, ranges })).toEqual([
        { kind: "text", text: "see " },
        { kind: "chip", key: "a", label: "[▣ a.png]" },
        { kind: "text", text: " now" },
      ]);
    });
  });

  describe("given the composer holds an image and its chip", () => {
    const markers = [
      { key: "a", label: "[▣ a.png]" },
      { key: "b", label: "[▣ b.png]" },
    ];

    /** @scenario Removing an image's chip from the text removes the image */
    it("names the images whose chip text left the draft", () => {
      expect(markersMissingFrom({ text: "see [▣ b.png]", markers })).toEqual(["a"]);
      expect(markersMissingFrom({ text: "see [▣ a.png", markers })).toEqual(["a", "b"]);
    });

    /** @scenario Removing an image's chip from the text removes the image */
    it("takes a chip out of the text with the space it brought", () => {
      expect(withoutMarker({ text: "see [▣ a.png] now", label: "[▣ a.png]" })).toBe("see now");
      expect(withoutMarker({ text: "[▣ a.png] now", label: "[▣ a.png]" })).toBe("now");
    });
  });
});
