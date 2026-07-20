/**
 * @vitest-environment jsdom
 *
 * Rendered behavior of the table's IO preview cell: the newline-marker
 * affordance and the media thumbnail/indicator badges. These render the real
 * component tree (with the density store boundary mocked), so they are
 * integration tests; the pure clamp-geometry helper stays in
 * IOPreview.unit.test.tsx.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IOPreview } from "../IOPreview";

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
        const marker = container.querySelector("[data-newline-marker]");
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
        expect(container.querySelector("[data-newline-marker]")).toBeNull();
      });
    });
  });
});

describe("IOPreview media badges", () => {
  const imageInput = JSON.stringify([
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "/api/files/p1/img1" } },
        { type: "text", text: "what is in this picture?" },
      ],
    },
  ]);
  const audioInput = JSON.stringify([
    {
      role: "user",
      content: [
        {
          type: "input_audio",
          input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
        },
      ],
    },
  ]);
  const pdfInput = JSON.stringify([
    {
      role: "user",
      content: [
        {
          type: "binary",
          mimeType: "application/pdf",
          url: "/api/files/p1/f1",
          filename: "report.pdf",
        },
      ],
    },
  ]);

  describe("given a root input carrying an image part", () => {
    /** @scenario "The trace list shows a tiny thumbnail when the root input carries an image" */
    it("renders the thumbnail below the preview text, drawer-style", () => {
      const { getByTestId, getByText } = renderPreview(imageInput, null);
      const thumb = getByTestId("io-preview-thumbnail");
      expect(thumb).toHaveAttribute("src", "/api/files/p1/img1");
      // Text first, image after it in document order — the same
      // text-then-media order the drawer renders.
      const text = getByText(/what is in this picture\?/);
      expect(
        text.compareDocumentPosition(thumb) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("given a root input carrying an audio recording", () => {
    /** @scenario "The trace list marks audio and attachments without inflating the row" */
    it("shows a compact audio indicator", () => {
      const { getByTestId } = renderPreview(audioInput, null);
      expect(getByTestId("io-preview-audio")).toBeInTheDocument();
    });
  });

  describe("given a root input carrying a PDF attachment", () => {
    it("shows a compact attachment indicator", () => {
      const { getByTestId } = renderPreview(pdfInput, null);
      expect(getByTestId("io-preview-attachment")).toBeInTheDocument();
    });
  });

  describe("given a plain text input", () => {
    it("renders no media badges", () => {
      const { queryByTestId } = renderPreview("just some text", null);
      expect(queryByTestId("io-preview-thumbnail")).toBeNull();
      expect(queryByTestId("io-preview-audio")).toBeNull();
      expect(queryByTestId("io-preview-attachment")).toBeNull();
    });
  });
});
