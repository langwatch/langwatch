/**
 * @vitest-environment jsdom
 *
 * Renders the "Grouped by LangWatch" badge against a real Chip + Tooltip
 * (only the Chakra system is provided) so the test exercises the actual
 * render, not a mock. The badge must:
 *   - appear only when the TRACE-level marker `langwatch.trace.synthetic`
 *     is "true", naming the grouping key,
 *   - stay hidden for ordinary traces, and
 *   - stay hidden when only the per-record SPAN marker is present (a real
 *     trace with one context-less record whose span id we minted).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { SyntheticTraceBadge } from "../SyntheticTraceBadge";

afterEach(() => {
  cleanup();
});

function renderBadge(attributes: Record<string, string>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SyntheticTraceBadge attributes={attributes} />
    </ChakraProvider>,
  );
}

describe("<SyntheticTraceBadge />", () => {
  describe("given the trace-level synthetic marker is set", () => {
    it("renders the badge", () => {
      renderBadge({
        "langwatch.trace.synthetic": "true",
        "langwatch.trace.derived_from": "session.id",
      });
      expect(screen.getByText("Grouped by LangWatch")).toBeInTheDocument();
    });

    it("names the grouping key in the badge's explanation", () => {
      renderBadge({
        "langwatch.trace.synthetic": "true",
        "langwatch.trace.derived_from": "session.id",
      });
      // The explanation is mirrored onto the accessible label and the hover
      // tooltip, so asserting the accessible label proves the reader is told
      // the trace was grouped by `session.id`.
      expect(screen.getByLabelText(/grouped them into one trace by session\.id/i))
        .toBeInTheDocument();
    });

    it("stays general when the ingestion path could not name a grouping key", () => {
      renderBadge({ "langwatch.trace.synthetic": "true" });
      expect(screen.getByText("Grouped by LangWatch")).toBeInTheDocument();
      expect(
        screen.queryByLabelText(/grouped them into one trace by/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("given an ordinary trace", () => {
    it("renders nothing", () => {
      renderBadge({ "service.name": "my-app" });
      expect(screen.queryByText("Grouped by LangWatch")).not.toBeInTheDocument();
    });
  });

  describe("given only the per-record span-level synthetic marker", () => {
    it("renders nothing (a real trace must not read as synthetic)", () => {
      renderBadge({ "langwatch.span.synthetic": "true" });
      expect(screen.queryByText("Grouped by LangWatch")).not.toBeInTheDocument();
    });
  });
});
