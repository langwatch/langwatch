import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * The win count printed above each bar, and specifically the one above the
 * TALLEST bar.
 *
 * The axis tops out at the highest tally, so the leading candidate's bar
 * reaches the top of the plot area exactly, its count is drawn above that, and
 * the chart clips anything outside its box. The result on a real run: a chart
 * of 4, 0 and 3 wins shows "3" over the short bar and nothing at all over the
 * winner, which is the one number the chart was added to communicate.
 *
 * jsdom has no layout, so the clipping itself is not observable here: the
 * label element exists in the DOM whether it is drawn on screen or off it.
 * What IS observable is the room the chart asks for, which is what decides
 * whether the label lands inside the box, so that is what these assert. The
 * arrangement is verified visually in the browser.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BatchComparisonColumn } from "@langwatch/experiment-web";
import {
  COUNT_LABEL_FONT_SIZE,
  COUNT_LABEL_OFFSET,
  WinRateChart,
} from "../win-rate-chart";

// recharts lays its chart out from measurements jsdom cannot produce, so the
// mock surfaces the geometry the component hands it instead. `margin.top` is
// the reserve under test; before the fix the chart passed no `top` at all and
// this reads NaN.
vi.mock("recharts", () => {
  const MockComponent = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    ResponsiveContainer: MockComponent,
    BarChart: ({
      margin,
      children,
    }: {
      margin?: { top?: number };
      children?: ReactNode;
    }) => (
      <div data-testid="bar-chart" data-margin-top={String(margin?.top)}>
        {children}
      </div>
    ),
    Bar: MockComponent,
    XAxis: MockComponent,
    YAxis: MockComponent,
    CartesianGrid: MockComponent,
    Tooltip: MockComponent,
    Cell: MockComponent,
    LabelList: MockComponent,
  };
});

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

/** A column whose verdicts hand out exactly the wins listed, one variant each. */
const columnWithWins = (wins: number[]): BatchComparisonColumn => {
  const verdictsByRow: BatchComparisonColumn["verdictsByRow"] = {};
  let rowIndex = 0;
  wins.forEach((count, variantIndex) => {
    for (let row = 0; row < count; row++) {
      verdictsByRow[rowIndex] = {
        rowIndex,
        winnerId: `target-${variantIndex}`,
      };
      rowIndex++;
    }
  });

  return {
    evaluatorId: "comparison-1",
    name: "Comparison",
    variants: wins.map((_, index) => ({
      id: `target-${index}`,
      name: `variant_${index + 1}`,
    })),
    verdictsByRow,
  };
};

/** Room the chart reserves above the plot area for this tally, in pixels. */
const reservedRoomFor = (wins: number[]): number => {
  const { getByTestId, unmount } = render(
    <WinRateChart column={columnWithWins(wins)} chartHeight={200} />,
    { wrapper: Wrapper },
  );
  const reserved = Number(getByTestId("bar-chart").dataset.marginTop);
  unmount();
  return reserved;
};

/** What the count needs to clear: its own height, plus the gap under it. */
const ROOM_A_COUNT_NEEDS = COUNT_LABEL_FONT_SIZE + COUNT_LABEL_OFFSET;

describe("WinRateChart count labels", () => {
  describe("given a run where one candidate leads", () => {
    /** @scenario "The leading candidate's win count stays legible" */
    it("reserves room above the plot area for the count over the tallest bar", () => {
      expect(reservedRoomFor([14, 10, 4])).toBeGreaterThanOrEqual(ROOM_A_COUNT_NEEDS);
    });
  });

  describe("when the tally grows", () => {
    // The property that picks a pixel reserve over axis headroom: padding the
    // axis maximum by a win buys room measured in wins, so it shrinks on
    // screen as the counts climb and the label disappears again on a long run.
    it("reserves the same room however many rows the run has", () => {
      const shortRun = reservedRoomFor([4, 3, 0]);
      const longRun = reservedRoomFor([140, 96, 41]);

      expect(longRun).toBe(shortRun);
      expect(longRun).toBeGreaterThanOrEqual(ROOM_A_COUNT_NEEDS);
    });
  });

  describe("given nobody has won a row yet", () => {
    it("still reserves the room, so the first count is not clipped", () => {
      expect(reservedRoomFor([0, 0])).toBeGreaterThanOrEqual(ROOM_A_COUNT_NEEDS);
    });
  });
});
