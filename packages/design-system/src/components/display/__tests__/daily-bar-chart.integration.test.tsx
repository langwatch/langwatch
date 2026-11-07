// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { DailyBarChart, dailyBarShares } from "../daily-bar-chart.tsx";

afterEach(cleanup);

describe("DailyBarChart", () => {
  /** @scenario "Each day is drawn against the busiest day" */
  it("draws each day against the busiest, a small day still visible and an empty day flat", () => {
    expect(dailyBarShares([100, 1, 0])).toEqual([1, 0.04, 0]);
    renderWithDesignSystem(
      <DailyBarChart
        bars={[
          { value: 100, title: "1 Nov: 100 events" },
          { value: 1, title: "2 Nov: 1 event" },
          { value: 0, title: "3 Nov: 0 events" },
        ]}
        axis={["1 Nov", "3 Nov"]}
        summary="Events per day"
      />,
    );
    const bars = screen.getAllByTestId("daily-bar");
    expect(bars).toHaveLength(3);
    expect(bars[0]).not.toHaveAttribute("data-empty");
    expect(bars[1]).not.toHaveAttribute("data-empty");
    expect(bars[2]).toHaveAttribute("data-empty", "true");
  });

  /** @scenario "Hovering a bar names its day and the axis labels the month" */
  it("titles each bar, labels the axis and reads the summary aloud", () => {
    renderWithDesignSystem(
      <DailyBarChart
        bars={Array.from({ length: 30 }, (_, index) => ({
          value: index + 1,
          title: `${index + 1} Nov: ${index + 1} events`,
        }))}
        axis={["1 Nov", "15 Nov", "30 Nov"]}
        summary="Events per day this month, from 1 Nov."
        data-testid="month-chart"
      />,
    );
    expect(screen.getByTestId("month-chart")).toBeInTheDocument();
    expect(screen.getAllByTestId("daily-bar")[2]).toHaveAttribute("title", "3 Nov: 3 events");
    expect(screen.getByText("15 Nov")).toBeInTheDocument();
    expect(screen.getByText("Events per day this month, from 1 Nov.")).toBeInTheDocument();
  });
});
