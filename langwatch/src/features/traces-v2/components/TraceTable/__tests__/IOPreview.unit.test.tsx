/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IOPreview, shouldHideBreakMarker } from "../IOPreview";

// Compact vs comfortable is gated by the density store; force compact so
// the row path under test is the one in the screenshot.
vi.mock("../../../stores/densityStore", () => ({
  useDensityStore: (selector: (s: { density: string }) => unknown) =>
    selector({ density: "compact" }),
  getDrawerDensityTokens: () => ({}),
}));

vi.mock("../../../hooks/useDensityTokens", () => ({
  useDensityTokens: () => ({ ioFontSize: "11px" }),
}));

function renderPreview(input: string | null, output: string | null) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IOPreview input={input} output={output} />
    </ChakraProvider>,
  );
}

describe("IOPreview newline marker", () => {
  describe("given preview text with a hard line break", () => {
    describe("when the preview renders", () => {
      /** @scenario The newline marker is not part of the selectable text */
      it("keeps the ↵ glyph out of the DOM text content so it can't be copied", () => {
        const { container } = renderPreview(
          "**Scope:**\nDate range: 2026-04-25 to 2026-05-24",
          null,
        );
        // The glyph is painted via a ::after pseudo-element, so it never
        // appears in textContent (which is what a selection copies).
        expect(container.textContent).not.toContain("↵");
        expect(container.textContent).toContain("Scope:");
        expect(container.textContent).toContain("Date range");
      });

      /** @scenario The newline marker sits at the end of the line that was broken */
      it("emits a zero-width, non-selectable marker span between the two lines", () => {
        const { container } = renderPreview("first line\nsecond line", null);
        const marker = container.querySelector('[data-newline-marker]');
        expect(marker).not.toBeNull();
        // user-select:none belt over the pseudo-element suspenders.
        expect(getComputedStyle(marker!).userSelect).toBe("none");
      });
    });
  });

  describe("given single-line preview text", () => {
    describe("when the preview renders", () => {
      /** @scenario A single-line preview renders no newline marker */
      it("emits no marker span", () => {
        const { container } = renderPreview("just one line", null);
        expect(
          container.querySelector('[data-newline-marker]'),
        ).toBeNull();
      });
    });
  });
});

describe("shouldHideBreakMarker", () => {
  // The clamp shows 2 lines, so a 40px clamped box is two 20px lines: the
  // last visible line (where the `…` lands) starts at y=20.
  const clampHeight = 40;

  describe("given the cell is not truncated", () => {
    describe("when a marker sits on any line", () => {
      it("keeps the marker visible", () => {
        expect(
          shouldHideBreakMarker({ truncated: false, markerTop: 0, clampHeight }),
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
