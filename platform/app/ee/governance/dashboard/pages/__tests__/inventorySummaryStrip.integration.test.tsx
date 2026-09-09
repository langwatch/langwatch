// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The resume strip above the Inventory's tabs, on the page.
 *
 * The unit test beside it pins the figures; this pins that they reach the
 * screen, that they sit ABOVE the tab strip rather than inside a pane, and
 * that the sentence they replaced is gone from the Sources pane. Two places
 * saying the same count is what the strip was added to stop.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import "@testing-library/jest-dom/vitest";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  connectTools,
  harness,
  openTab,
  renderScreen,
} from "./inventoryScreenHarness";

describe("given an admin on the Inventory page", () => {
  describe("when the page renders with tools and sources", () => {
    beforeEach(connectTools);

    /** @scenario "A strip above the tabs resumes each pane" */
    it("resumes all three panes above the tab strip", () => {
      renderScreen();
      const strip = screen.getByTestId("inventory-summary");
      expect(within(strip).getByText("tools")).toBeInTheDocument();
      expect(within(strip).getByText("environments")).toBeInTheDocument();
      expect(within(strip).getByText("sources")).toBeInTheDocument();
      // Three tools registered, two sources connected: reading either figure
      // off the other list is visible rather than a coincidence.
      expect(within(strip).getByText("3")).toBeInTheDocument();
      expect(within(strip).getByText("3 vendors")).toBeInTheDocument();
      expect(within(strip).getByText("2 active")).toBeInTheDocument();
    });

    /** @scenario "A strip above the tabs resumes each pane" */
    it("puts the strip before the tabs in the document", () => {
      renderScreen();
      const strip = screen.getByTestId("inventory-summary");
      const firstTab = screen.getAllByRole("tab")[0]!;
      expect(
        strip.compareDocumentPosition(firstTab) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario "The Sources pane no longer repeats the strip's own count" */
    it("drops the Connectors heading from inside the Sources pane", async () => {
      renderScreen();
      await openTab(/Sources/);
      expect(screen.queryByText("Connectors")).toBeNull();
      expect(screen.queryByText(/\d+ sources · \d+ active/)).toBeNull();
    });
  });

  describe("when the reader cannot see the tool registry", () => {
    /** @scenario "A figure the page cannot measure is a dash, never a zero" */
    it("draws a dash for the tool count rather than a zero", () => {
      harness.permissions = [
        "organization:view",
        "governance:view",
        "ingestionSources:view",
      ];
      connectTools();
      renderScreen();
      const strip = screen.getByTestId("inventory-summary");
      // The em dash, not "0". "0 tools" would be a confident wrong answer
      // where the honest one is that this reader cannot be told.
      expect(within(strip).getByText("—")).toBeInTheDocument();
      expect(within(strip).queryByText("3 vendors")).toBeNull();
    });
  });

  describe("when the registry read has not answered yet", () => {
    // The second way to reach a false zero, and the one that bit first: the
    // reader HOLDS the grant, so the earlier permission guard says nothing,
    // but the query is still in flight. The hook hands callers an empty array
    // so renderers need no guard, and counting that default reports a registry
    // of zero tools that nobody has looked at.
    /** @scenario "A figure the page cannot measure is a dash, never a zero" */
    it("draws a dash and no tab count while the registry is loading", () => {
      harness.tools = { data: undefined, isLoading: true, error: null };
      renderScreen();

      const strip = screen.getByTestId("inventory-summary");
      expect(within(strip).getByText("—")).toBeInTheDocument();
      expect(within(strip).queryByText(/^0 tools/)).toBeNull();
      // The tab badge is the same claim in a smaller place.
      expect(screen.getByRole("tab", { name: /^Catalog/ }).textContent).toBe(
        "Catalog",
      );
    });
  });

  describe("when the source read has not answered yet", () => {
    // The third way to a false zero, and the one that survived the first two
    // fixes: environments are not read, they are DERIVED from the source list.
    // An unanswered source read makes that derivation return an empty array,
    // so the strip said "0 environments" immediately beside the dash it had
    // correctly drawn for sources — one silence, reported two ways.
    /** @scenario "A figure the page cannot measure is a dash, never a zero" */
    it("draws a dash for environments whenever it draws one for sources", () => {
      harness.sources = { data: undefined, isLoading: true, error: null };
      renderScreen();

      const strip = screen.getByTestId("inventory-summary");
      expect(within(strip).queryByText(/^0 discovered/)).toBeNull();
      expect(strip.textContent).not.toMatch(/0environments/);
      // Both halves of the derivation say the same thing.
      expect(within(strip).getAllByText("—").length).toBeGreaterThanOrEqual(2);
      // And the tab badge agrees with the tab beside it.
      expect(
        screen.getByRole("tab", { name: /^Environments/ }).textContent,
      ).toBe("Environments");
      expect(screen.getByRole("tab", { name: /^Sources/ }).textContent).toBe(
        "Sources",
      );
    });

    /** @scenario "A figure the page cannot measure is a dash, never a zero" */
    it("draws a dash for environments when the source read failed", () => {
      harness.sources = {
        data: undefined,
        isLoading: false,
        error: new Error("source list unavailable"),
      };
      renderScreen();

      const strip = screen.getByTestId("inventory-summary");
      expect(strip.textContent).not.toMatch(/0environments/);
      expect(within(strip).queryByText(/^0 discovered/)).toBeNull();
    });
  });
});
