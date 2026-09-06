/**
 * @vitest-environment node
 *
 * Pure clamp-geometry helper for the IO preview's newline markers. The
 * rendered behavior (markers in the DOM, media badges) lives in
 * IOPreview.integration.test.tsx — this file only covers logic with no
 * component tree.
 */
import { describe, expect, it } from "vitest";
import { shouldHideBreakMarker } from "../IOPreview";

describe("shouldHideBreakMarker", () => {
  // The clamp shows 2 lines, so a 40px clamped box is two 20px lines: the
  // last visible line (where the `…` lands) starts at y=20.
  const clampHeight = 40;

  describe("given the cell is not truncated", () => {
    describe("when a marker sits on any line", () => {
      it("keeps the marker visible", () => {
        expect(
          shouldHideBreakMarker({
            truncated: false,
            markerTop: 0,
            clampHeight,
          }),
        ).toBe(false);
        expect(
          shouldHideBreakMarker({
            truncated: false,
            markerTop: 20,
            clampHeight,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given the cell is truncated", () => {
    describe("when the marker is on a fully-visible earlier line", () => {
      it("keeps the marker visible so the break is still signalled", () => {
        expect(
          shouldHideBreakMarker({ truncated: true, markerTop: 0, clampHeight }),
        ).toBe(false);
      });
    });

    describe("when the marker is on the last visible (clamped) line", () => {
      it("hides the marker so the ↵ never overlaps the clamp ellipsis", () => {
        expect(
          shouldHideBreakMarker({
            truncated: true,
            markerTop: 20,
            clampHeight,
          }),
        ).toBe(true);
      });
    });

    describe("when the marker is below the fold", () => {
      it("hides the marker", () => {
        expect(
          shouldHideBreakMarker({
            truncated: true,
            markerTop: 40,
            clampHeight,
          }),
        ).toBe(true);
      });
    });
  });
});
