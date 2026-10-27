/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  TimeSeriesChart,
  type TimeSeriesSeries,
} from "../src/components/display/time-series-chart.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const DAYS = [
  "Mon 5 Oct",
  "Tue 6 Oct",
  "Wed 7 Oct",
  "Thu 8 Oct",
  "Fri 9 Oct",
  "Sat 10 Oct",
  "Sun 11 Oct",
];
const REQUESTS = [1180, 1260, 1420, 1310, 1240, 640, 560];
const ERRORS = [6, 5, 11, 7, 6, 3, 2];

function daily({ name, values }: { name: string; values: number[] }): TimeSeriesSeries {
  return { name, points: values.map((value, at) => ({ label: DAYS[at] ?? "", value })) };
}

const requests = ({ value }: { value: number }) => `${value.toLocaleString("en-US")} requests`;

const BOX = { x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 220, width: 640, height: 220 };
const NONE = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom has no layout: the chart's container gets a 640 x 220 box so it can size itself.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const box = this.className.includes("recharts-legend") ? NONE : BOX;
    return { ...box, toJSON: () => box };
  });
});

afterAll(() => vi.restoreAllMocks());

afterEach(cleanup);

describe("given a series of seven daily readings", () => {
  describe("when the chart is drawn", () => {
    /** @scenario The chart is named and described from its points */
    it("names the figure and describes the first, last, highest, lowest and latest readings", () => {
      renderWithDesignSystem(
        <TimeSeriesChart
          label="Requests per day"
          series={[daily({ name: "Requests", values: REQUESTS })]}
          formatValue={requests}
        />,
      );
      const image = screen.getByRole("figure", { name: "Requests per day" });
      const description = document.getElementById(image.getAttribute("aria-describedby") ?? "");

      const highest = Math.max(...REQUESTS);
      const lowest = Math.min(...REQUESTS);
      expect(description?.textContent).toContain("7 readings from Mon 5 Oct to Sun 11 Oct");
      expect(description?.textContent).toContain(
        `Highest ${highest.toLocaleString("en-US")} requests on ${DAYS[REQUESTS.indexOf(highest)]}`,
      );
      expect(description?.textContent).toContain(
        `lowest ${lowest.toLocaleString("en-US")} requests on ${DAYS[REQUESTS.indexOf(lowest)]}`,
      );
      expect(description?.textContent).toContain(`latest ${REQUESTS.at(-1)} requests`);
    });

    /** @scenario The chart is named and described from its points */
    it("uses the summary it was given in place of the derived one", () => {
      renderWithDesignSystem(
        <TimeSeriesChart
          label="Requests per day"
          summary="Busy on weekdays, quiet at the weekend."
          series={[daily({ name: "Requests", values: REQUESTS })]}
          formatValue={requests}
        />,
      );
      const image = screen.getByRole("figure", { name: "Requests per day" });
      expect(
        document.getElementById(image.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toBe("Busy on weekdays, quiet at the weekend.");
    });
  });

  describe("when the pointer rests over the third day", () => {
    /** @scenario Hovering reads the nearest moment */
    it("shows that day and its value in the formatted unit", async () => {
      renderWithDesignSystem(
        <TimeSeriesChart
          label="Requests per day"
          series={[daily({ name: "Requests", values: REQUESTS })]}
          formatValue={requests}
        />,
      );
      expect(document.querySelector("[data-chart-tooltip]")).toBeNull();

      // The plot runs from x 56 to 632, so the seven days sit 96px apart.
      const surface = document.querySelector(".recharts-wrapper");
      if (!surface) throw new Error("The chart drew no plot");
      fireEvent.mouseMove(surface, { clientX: 56 + 2 * 96, clientY: 100 });

      await waitFor(() => expect(document.querySelector("[data-chart-tooltip]")).not.toBeNull());
      const reading = document.querySelector("[data-chart-tooltip]");
      expect(reading?.textContent).toContain("Wed 7 Oct");
      expect(reading?.textContent).toContain("Requests");
      expect(reading?.textContent).toContain("1,420 requests");
    });
  });
});

describe("given two series sharing the same days", () => {
  describe("when the chart is drawn", () => {
    /** @scenario Several series are told apart by a legend */
    it("draws a line per series and names both in the legend", () => {
      renderWithDesignSystem(
        <TimeSeriesChart
          label="Requests and errors per day"
          series={[
            daily({ name: "Requests", values: REQUESTS }),
            daily({ name: "Errors", values: ERRORS }),
          ]}
          formatValue={requests}
        />,
      );
      expect(document.querySelectorAll(".recharts-area")).toHaveLength(2);
      const legend = document.querySelector(".recharts-legend-wrapper");
      expect(legend?.textContent).toContain("Requests");
      expect(legend?.textContent).toContain("Errors");
    });

    /** @scenario Several series are told apart by a legend */
    it("shows no legend for a single series", () => {
      renderWithDesignSystem(
        <TimeSeriesChart
          label="Requests per day"
          series={[daily({ name: "Requests", values: REQUESTS })]}
          formatValue={requests}
        />,
      );
      expect(document.querySelectorAll(".recharts-area")).toHaveLength(1);
      expect(document.querySelector(".recharts-legend-wrapper")).toBeNull();
    });
  });
});

describe("given a series with no points", () => {
  describe("when the chart is drawn", () => {
    /** @scenario A chart with no points keeps its box and says so */
    it("says there is no data, gives its sentence and draws no figure", () => {
      renderWithDesignSystem(
        <TimeSeriesChart
          label="Requests per day"
          series={[{ name: "Requests", points: [] }]}
          formatValue={requests}
          emptyDescription="Send a request and it appears here."
        />,
      );
      expect(screen.getByText("No data for this period")).toBeTruthy();
      expect(screen.getByText("Send a request and it appears here.")).toBeTruthy();
      expect(screen.queryByRole("figure")).toBeNull();
    });
  });
});

describe("given one series and then two", () => {
  /** @scenario One series is orange and several take the chart palette in order */
  it("draws a lone series in orange and several in the chart colours", () => {
    const { unmount } = renderWithDesignSystem(
      <TimeSeriesChart
        label="Requests per day"
        series={[daily({ name: "Requests", values: REQUESTS })]}
        formatValue={requests}
      />,
    );
    const lone = document.querySelector(".recharts-area-curve")?.getAttribute("stroke");
    expect(lone).toBe("var(--chakra-colors-orange-solid)");
    unmount();

    renderWithDesignSystem(
      <TimeSeriesChart
        label="Requests and errors per day"
        series={[
          daily({ name: "Requests", values: REQUESTS }),
          daily({ name: "Errors", values: ERRORS }),
        ]}
        formatValue={requests}
      />,
    );
    const strokes = Array.from(document.querySelectorAll(".recharts-area-curve")).map((curve) =>
      curve.getAttribute("stroke"),
    );
    expect(strokes).toEqual(["var(--chakra-colors-chart-1)", "var(--chakra-colors-chart-2)"]);
  });
});
