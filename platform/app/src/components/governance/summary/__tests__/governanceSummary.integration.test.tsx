/**
 * @vitest-environment jsdom
 *
 * The section's two resume shapes, rendered.
 *
 * These are laid out here rather than on the three pages that use them because
 * the claim under test belongs to the shape and not to any page: what a strip
 * does with a figure nobody measured is the same answer on Inventory, People
 * and Agents, and asserting it three times would be three chances to disagree.
 * The pages assert that they render the strip; this file asserts what the
 * strip then does.
 *
 * Nothing here reads a colour. jsdom resolves no CSS variable, so a token can
 * only be checked at the level of the reference it emits, and none of these
 * rules is about a colour anyway — they are about which words and which
 * figures reach the screen.
 *
 * Spec: specs/ai-governance/dashboard/governance-summary-strip.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  GovernanceSummaryBar,
  type GovernanceSummaryBarItem,
  GovernanceSummaryCard,
  GovernanceSummaryCards,
  GovernanceSummaryRankRow,
  GovernanceSummarySparkline,
  GovernanceSummaryStatusRow,
} from "../index";

afterEach(cleanup);

function renderWithChakra(ui: ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

/**
 * A strip of the shape the three pages asked for: a count, what it counts, and
 * a second reading of the same population underneath.
 */
const FOUR_FIGURES: GovernanceSummaryBarItem[] = [
  { key: "tools", value: "8", label: "tools", hint: "7 vendors" },
  { key: "seats", value: "345", label: "seats", hint: "103 idle" },
  { key: "connectors", value: "8", label: "connectors", hint: "1 behind" },
  { key: "requests", value: "2", label: "requests", hint: "1 waiting" },
];

describe("GovernanceSummaryBar", () => {
  describe("given four measured figures", () => {
    /** @scenario "A summary strip states each figure beside the label it counts" */
    it("puts every figure, label and hint on screen", () => {
      renderWithChakra(
        <GovernanceSummaryBar items={FOUR_FIGURES} testId="summary-strip" />,
      );

      const strip = screen.getByTestId("summary-strip");
      for (const item of FOUR_FIGURES) {
        expect(within(strip).getByText(item.label)).toBeVisible();
        expect(within(strip).getByText(item.hint as string)).toBeVisible();
      }
      expect(within(strip).getByText("345")).toBeVisible();

      // The copy rule, asserted rather than trusted: the strip renders the
      // caller's words untouched, so a shortened one would reach the screen.
      expect(strip.textContent).not.toMatch(/\b(req|tok|conn|vendr)\b/);
    });
  });

  describe("given a figure the read side could not measure", () => {
    /** @scenario "A summary figure that was never measured reads as an em dash" */
    it("draws an em dash rather than a zero", () => {
      renderWithChakra(
        <GovernanceSummaryBar
          testId="summary-strip"
          items={[
            { key: "seats", value: null, label: "seats", hint: "not reported" },
          ]}
        />,
      );

      const strip = screen.getByTestId("summary-strip");
      expect(within(strip).getByText("—")).toBeVisible();
      expect(within(strip).queryByText("0")).toBeNull();
    });
  });

  describe("given nothing to show", () => {
    /** @scenario "A summary strip with no figures draws no card at all" */
    it("renders no card", () => {
      renderWithChakra(
        <GovernanceSummaryBar items={[]} testId="summary-strip" />,
      );

      expect(screen.queryByTestId("summary-strip")).toBeNull();
    });
  });
});

describe("GovernanceSummaryCards", () => {
  describe("given a card with an eyebrow and content", () => {
    /** @scenario "A summary card names what it holds in an eyebrow above its content" */
    it("shows the eyebrow above what the card holds", () => {
      renderWithChakra(
        <GovernanceSummaryCards testId="summary-cards">
          <GovernanceSummaryCard eyebrow="Fleet" testId="fleet-card">
            14 agents
          </GovernanceSummaryCard>
        </GovernanceSummaryCards>,
      );

      const card = screen.getByTestId("fleet-card");
      expect(within(card).getByText("Fleet")).toBeVisible();
      expect(within(card).getByText("14 agents")).toBeVisible();
    });
  });

  describe("given a status row for items that are responding", () => {
    /** @scenario "A status row states the count and what those items are doing" */
    it("states the count and the word, with the dot marked decorative", () => {
      renderWithChakra(
        <GovernanceSummaryCard eyebrow="Health" testId="health-card">
          <GovernanceSummaryStatusRow
            tone="good"
            value="11"
            label="responding"
          />
        </GovernanceSummaryCard>,
      );

      const card = screen.getByTestId("health-card");
      expect(within(card).getByText("11")).toBeVisible();
      expect(within(card).getByText("responding")).toBeVisible();

      // Guard the guard: the row really does render a dot, and that dot is
      // the element carrying aria-hidden. Asserting only "a hidden element
      // exists" would pass on a row that had lost its dot entirely.
      const decorative = card.querySelectorAll('[aria-hidden="true"]');
      expect(decorative).toHaveLength(1);
      expect(decorative[0]?.textContent).toBe("");
    });
  });

  describe("given a ranked row", () => {
    /** @scenario "A ranked row puts the name on the left and its share on the right" */
    it("shows the name and the share in one row", () => {
      renderWithChakra(
        <GovernanceSummaryCard eyebrow="Top spenders" testId="spenders-card">
          <GovernanceSummaryRankRow label="ACME platform team" value="41%" />
        </GovernanceSummaryCard>,
      );

      const card = screen.getByTestId("spenders-card");
      expect(within(card).getByText("ACME platform team")).toBeVisible();
      expect(within(card).getByText("41%")).toBeVisible();
    });
  });

  describe("given fewer than two points to plot", () => {
    /** @scenario "A summary sparkline is left out when there is nothing to draw" */
    it("draws no sparkline, and draws one once there are two points", () => {
      const { unmount } = renderWithChakra(
        <GovernanceSummarySparkline
          points={[3]}
          label="Agents responding over the last thirty days"
        />,
      );
      expect(screen.queryByTestId("governance-summary-sparkline")).toBeNull();
      unmount();

      // The other half of the same claim: absence above is the guard working,
      // not the component being broken.
      renderWithChakra(
        <GovernanceSummarySparkline
          points={[3, 5, 4]}
          label="Agents responding over the last thirty days"
        />,
      );
      expect(
        screen.getByTestId("governance-summary-sparkline"),
      ).toBeInTheDocument();
    });
  });
});
