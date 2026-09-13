// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment jsdom
 *
 * What the two cost-over-time charts draw for a period that is short.
 *
 * Both charts are rendered through the same chart component with the sized
 * container `periodRecords.integration.test.tsx` gives it, so recharts lays
 * the bars out and the shape each one is drawn in is real. jsdom has no
 * layout of its own, so the assertions are on the elements and what they say,
 * never on pixels.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    // The only reason the chart draws at all. Everything below it is
    // recharts' own.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 240 }),
  };
});

vi.mock("~/utils/api", () => ({
  api: {
    governanceCost: {
      periodRecords: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
    },
  },
}));

import {
  CostStackedBars,
  WITHHELD_BAR_LABEL,
  WITHHELD_EMPTY_BAR_LABEL,
} from "../CostCharts";
import {
  CostProviderDayPanel,
  costTotalBuckets,
  PartialSpendNote,
  partialProviderNotes,
} from "../CostProviderDayPanel";

/** A single-provider window whose ONLY day holds no dollar figure. */
const EVERY_DAY_WITHHELD = [
  {
    day: "2026-01-16",
    provider: "anthropic_admin",
    amountUsd: null,
    cellsWithoutAmount: 1,
    currenciesWithoutUsdAmount: [],
  },
];

/** Two providers in one month, one of them with a withheld day. */
const ONE_DAY_WITHHELD = [
  {
    day: "2026-01-15",
    provider: "openai_admin",
    amountUsd: 60,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
  {
    day: "2026-01-16",
    provider: "anthropic_admin",
    amountUsd: null,
    cellsWithoutAmount: 1,
    currenciesWithoutUsdAmount: [],
  },
];

/** The total chart the way the Costs screen mounts it. */
function TotalChart({ rows }: { rows: typeof ONE_DAY_WITHHELD }) {
  const buckets = costTotalBuckets(rows, "month");
  return (
    <div aria-label="Cost over time">
      <CostStackedBars buckets={buckets} interval="month" showLegend={false} />
      <PartialSpendNote providers={partialProviderNotes(buckets)} />
    </div>
  );
}

const renderBoth = (rows: typeof ONE_DAY_WITHHELD) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TotalChart rows={rows} />
      <CostProviderDayPanel
        organizationId="org-1"
        rows={rows as never}
        interval="month"
      />
    </ChakraProvider>,
  );

const totalChart = () => within(screen.getByLabelText("Cost over time"));
const splitChart = () =>
  within(screen.getByLabelText("Cost over time · by provider"));

afterEach(() => cleanup());

describe("a short period on the cost-over-time charts", () => {
  describe("given every day of the window is withheld", () => {
    /** @scenario "A period whose every day is withheld still shows a withheld mark" */
    it("stands a withheld mark where the bar would be, on both charts", () => {
      renderBoth(EVERY_DAY_WITHHELD);

      // There is no bar: nothing was added up. A chart left to itself draws
      // nothing for a height of zero, and an empty slot reads as a period
      // nobody spent anything in — which is not what we know.
      for (const chart of [totalChart(), splitChart()]) {
        const mark = chart.getByLabelText(WITHHELD_EMPTY_BAR_LABEL);
        expect(mark).toHaveAttribute("data-withheld", "empty");
        // A dash, not a colour, is the cue.
        const outline = mark.querySelector("rect");
        expect(outline).not.toBeNull();
        expect(outline).toHaveAttribute("stroke-dasharray");
        expect(outline).toHaveAttribute("fill", "none");
      }
      // And nothing on either chart claims to be a short bar with a figure.
      expect(document.querySelectorAll('[data-withheld="short"]')).toHaveLength(
        0,
      );
    });
  });

  describe("given one provider has a day we hold no dollar figure for", () => {
    /** @scenario "The provider split marks a short period the same way the total chart does" */
    it("marks the period short on the provider split exactly as on the total chart", () => {
      renderBoth(ONE_DAY_WITHHELD);

      // The same period, the same mark, the same words under each chart.
      for (const chart of [totalChart(), splitChart()]) {
        const bar = chart.getByLabelText(WITHHELD_BAR_LABEL);
        expect(bar).toHaveAttribute("data-withheld", "short");
        // Recharts' own rectangle is still inside, faded and dash-edged,
        // so the click that opens a period still lands on it.
        const rectangle = bar.querySelector(".recharts-rectangle");
        expect(rectangle).not.toBeNull();
        expect(rectangle).toHaveAttribute("stroke-dasharray");
        expect(
          chart.getByLabelText(/cover only part of what was spent/i),
        ).toHaveTextContent(/Anthropic/);
      }
      // There is a bar to mark, so no stand-in is drawn.
      expect(document.querySelectorAll('[data-withheld="empty"]')).toHaveLength(
        0,
      );
    });
  });
});
