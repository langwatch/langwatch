/**
 * @vitest-environment jsdom
 *
 * Round 5: the rendered-Markdown view in the I/O viewer must sit in the same
 * bordered "bg.subtle + border" container that Pretty uses for plain text and
 * JSON. Previously it painted flush — bare prose floating in the pane next to
 * Pretty's tidy box. This test toggles into Markdown and asserts the body is
 * wrapped in a bordered container, by executing the real render path.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { IOViewer } from "../IOViewer";

afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Markdown content with structural signals but NO fenced code block, so the
// render path stays synchronous (no Shiki / ClientOnly to await).
const MARKDOWN =
  "# Report\n\nThe summary line.\n\n- first point\n- second point";

/** Walk up from a node to the nearest ancestor painting a 1px border. */
function nearestBorderedAncestor(node: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = node;
  while (el) {
    if (getComputedStyle(el).borderTopWidth === "1px") return el;
    el = el.parentElement;
  }
  return null;
}

describe("IOViewer Markdown container", () => {
  describe("given Markdown-looking content rendered in the Markdown view", () => {
    it("wraps the rendered Markdown body in a bordered container", () => {
      render(<IOViewer label="Output" content={MARKDOWN} />, { wrapper });

      // Toggle from the default Pretty view to Markdown (defaults to the
      // rendered submode). The toggle button label is the format name.
      fireEvent.click(screen.getByRole("button", { name: /^markdown$/i }));

      // The heading renders as real Markdown (an <h1>), proving we're on the
      // rendered path and not the flush raw-text fallback.
      const heading = screen.getByRole("heading", { name: "Report" });
      expect(heading).toBeInTheDocument();

      // ...and that rendered content sits inside a bordered box.
      expect(nearestBorderedAncestor(heading)).not.toBeNull();
    });
  });
});
