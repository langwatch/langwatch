/**
 * Long unbreakable strings — signed URLs, base64 payloads, tool-result JSON —
 * used to paint outside their container.
 *
 * Chakra's preflight already puts `word-wrap: break-word` on `*`, so ordinary
 * paragraph text has always wrapped. Two shapes escape it, and both are here:
 *
 *  - an autolinked URL renders through Chakra's link recipe, whose base is
 *    `display: inline-flex`. That is an atomic inline box — it cannot be split
 *    across line boxes at all, so an inherited wrap rule never reaches it.
 *  - a markdown table uses `table-layout: auto`, which sizes columns from
 *    min-content. `overflow-wrap: break-word` deliberately does not shrink
 *    min-content, so one unbreakable cell widens the whole table.
 *
 * jsdom cannot catch either — it has no layout, so `scrollWidth` is always 0.
 * These assertions need real Chromium.
 *
 * https://github.com/langwatch/langwatch/issues/7433
 */

import { Box, ChakraProvider } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { RenderedMarkdown } from "~/features/traces-v2/components/TraceDrawer/markdownView/RenderedMarkdown";
import { system } from "~/pages/_app";
import { Markdown } from "../Markdown";

/**
 * The shape from the report: an external URL whose query string is one long
 * run of `%3A` / `&` / `=` / `_`, which offers no UAX#14 break opportunity.
 */
const SIGNED_URL =
  "https://host.example/download?token=" +
  "A".repeat(200) +
  "&filter=a%3Ab%3Ac%3Ad%3Ae%3Af&scope=read_write_admin";

/**
 * 480 characters, no whitespace, no `/` or `-`: zero break opportunities.
 *
 * One repeated character rather than a mixed alphanumeric run. Line breaking
 * does not care which characters these are — only that none of them offers a
 * break — but a secret scanner does: a `*_TOKEN` constant holding a long
 * high-entropy literal reads as an API key and fails the build.
 */
const UNBREAKABLE_RUN = "a".repeat(480);

const CONTAINER_WIDTH = 320;

/** Mirrors the real shape: a width-constrained scroll region (drawer body). */
function ConstrainedViewport({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ChakraProvider value={system}>
        <Box
          data-testid="viewport"
          width={`${CONTAINER_WIDTH}px`}
          overflow="hidden"
        >
          {children}
        </Box>
      </ChakraProvider>
    </MemoryRouter>
  );
}

/**
 * The container's own `scrollWidth` misses ink that overflows a line box, so
 * measure where the widest descendant actually paints. That is the reported
 * symptom: text landing to the right of the container's edge.
 */
function widestPaintedEdge() {
  const viewport = document.querySelector<HTMLElement>(
    '[data-testid="viewport"]',
  );
  if (!viewport) throw new Error("viewport not rendered");
  const containerRight = viewport.getBoundingClientRect().right;

  /**
   * A scroll container legitimately holds wider content — that is what its
   * scrollbar is for — and so does everything nested inside it. Only overflow
   * that nothing clips reaches the screen as the reported symptom.
   */
  const isClipped = (el: HTMLElement) => {
    // Stop *before* the viewport: it is the reference frame we are measuring
    // against, not a clipper whose overflow excuses the content inside it.
    for (
      let node: HTMLElement | null = el;
      node && node !== viewport;
      node = node.parentElement
    ) {
      if (getComputedStyle(node).overflowX !== "visible") return true;
    }
    return false;
  };

  let widest = containerRight;
  for (const el of Array.from(viewport.querySelectorAll<HTMLElement>("*"))) {
    if (isClipped(el)) continue;
    widest = Math.max(widest, el.getBoundingClientRect().right);
  }
  return { containerRight, widest, overhang: widest - containerRight };
}

afterEach(() => cleanup());

describe("given a markdown message body with an unbreakable string", () => {
  describe("when the text contains a long autolinked URL", () => {
    it("keeps the link inside the container", () => {
      render(
        <ConstrainedViewport>
          <Markdown>{SIGNED_URL}</Markdown>
        </ConstrainedViewport>,
      );

      expect(widestPaintedEdge().overhang).toBeLessThanOrEqual(0);
    });

    it("renders the anchor as a breakable inline box, not an atomic one", () => {
      render(
        <ConstrainedViewport>
          <Markdown>{SIGNED_URL}</Markdown>
        </ConstrainedViewport>,
      );

      const anchor = document.querySelector("a");
      if (!anchor) throw new Error("no anchor rendered");
      expect(getComputedStyle(anchor).display).toBe("inline");
    });
  });

  describe("when a tool result embeds a URL in its JSON", () => {
    it("keeps the message inside the container", () => {
      render(
        <ConstrainedViewport>
          <Markdown>{`[tool_complete] {"url": "${SIGNED_URL}"}`}</Markdown>
        </ConstrainedViewport>,
      );

      expect(widestPaintedEdge().overhang).toBeLessThanOrEqual(0);
    });
  });

  describe("when an unbreakable run sits in a table cell", () => {
    it("keeps the table inside the container", () => {
      render(
        <ConstrainedViewport>
          <Markdown>{`| url |\n| --- |\n| ${UNBREAKABLE_RUN} |`}</Markdown>
        </ConstrainedViewport>,
      );

      expect(widestPaintedEdge().overhang).toBeLessThanOrEqual(0);
    });
  });

  /**
   * The guard against over-fixing. Breaking a fenced code block mid-token is
   * worse than scrolling it, so `& pre` keeps `overflow-x: auto` and the code
   * inside must stay on one line.
   */
  describe("when the run is in a fenced code block", () => {
    it("scrolls the code block horizontally rather than breaking the line", () => {
      render(
        <ConstrainedViewport>
          <Markdown>{`\`\`\`\n${UNBREAKABLE_RUN}\n\`\`\``}</Markdown>
        </ConstrainedViewport>,
      );

      const pre = document.querySelector<HTMLElement>("pre");
      if (!pre) throw new Error("no code block rendered");

      expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
      expect(widestPaintedEdge().overhang).toBeLessThanOrEqual(0);
    });
  });
});

describe("given a trace drawer markdown view with an unbreakable string", () => {
  describe("when the text contains a long autolinked URL", () => {
    it("keeps the link inside the container", () => {
      render(
        <ConstrainedViewport>
          <RenderedMarkdown markdown={SIGNED_URL} />
        </ConstrainedViewport>,
      );

      expect(widestPaintedEdge().overhang).toBeLessThanOrEqual(0);
    });

    it("renders the anchor as a breakable inline box, not an atomic one", () => {
      render(
        <ConstrainedViewport>
          <RenderedMarkdown markdown={SIGNED_URL} />
        </ConstrainedViewport>,
      );

      const anchor = document.querySelector("a");
      if (!anchor) throw new Error("no anchor rendered");
      expect(getComputedStyle(anchor).display).toBe("inline");
    });
  });
});
