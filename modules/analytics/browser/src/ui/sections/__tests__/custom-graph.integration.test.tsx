/** @vitest-environment jsdom */

/**
 * Two properties are pinned here because both fail SILENTLY: dropping
 * `excludeUnknownBuckets` puts "unknown" atop a leaderboard as a real
 * user; a failed read must render retry, not an empty "no traffic" plot.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const timeseries = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as unknown,
  isLoading: false,
}));

vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    analytics: {
      getTimeseries: {
        useQuery: () => ({
          data: timeseries.data,
          error: timeseries.error,
          isLoading: timeseries.isLoading,
          isError: timeseries.error !== null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

/**
 * Recharts measures its own container, but jsdom reports every box as
 * zero, so `ResponsiveContainer` renders nothing and series assertions
 * pass vacuously. Giving it a size is the only way to see what it drew.
 */
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof rechartsModule>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={800} height={400}>
        {children as never}
      </actual.ResponsiveContainer>
    ),
  };
});

vi.mock("../../../behavior/use-filter-params.ts", () => ({
  useFilterParams: () => ({
    filterParams: { projectId: "proj-1", startDate: 0, endDate: 1, filters: {} },
    queryOpts: { enabled: true },
  }),
}));

import type * as rechartsModule from "recharts";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import { CustomGraph, type CustomGraphInput } from "../custom-graph.tsx";

afterEach(() => {
  cleanup();
  timeseries.data = undefined;
  timeseries.error = null;
  timeseries.isLoading = false;
});

/** A grouped leaderboard, which is where the unknown bucket shows up. */
const leaderboard: CustomGraphInput = {
  graphId: "userLeaderboard",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Traces count",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "metadata.user_id",
  excludeUnknownBuckets: true,
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

function bucketed() {
  return {
    previousPeriod: [],
    currentPeriod: [
      {
        date: "2026-06-01",
        "metadata.user_id": {
          "user-a": { "metadata.trace_id/cardinality": 12 },
          unknown: { "metadata.trace_id/cardinality": 99 },
        },
      },
    ],
  };
}

/**
 * The group labels the chart actually plotted, read off its own axis —
 * not `getByText`, since a substring matcher would say "unknown is absent"
 * for a chart that plotted `User unknown`, the exact failure this file catches.
 */
function plottedGroups(): string[] {
  return [...document.querySelectorAll(".recharts-cartesian-axis-tick-value")].map(
    (node) => node.textContent ?? "",
  );
}

function renderGraph(input: CustomGraphInput) {
  return render(
    <AnalyticsTestHarness host={new StubAnalyticsHost()}>
      <CustomGraph input={input} />
    </AnalyticsTestHarness>,
  );
}

describe("the analytics chart", () => {
  describe("given a grouped result carrying an unknown bucket", () => {
    describe("when the chart asks for unknown buckets to be excluded", () => {
      /** @scenario "A leaderboard leaves the unknown grouping bucket out" */
      it("plots the named group and leaves the unknown one out", () => {
        timeseries.data = bucketed();

        renderGraph(leaderboard);

        const groups = plottedGroups();
        expect(groups.some((label) => label.includes("user-a"))).toBe(true);
        expect(groups.some((label) => label.includes("unknown"))).toBe(false);
      });
    });

    describe("when the chart does not ask for them to be excluded", () => {
      it("plots the unknown bucket, so the exclusion is doing the work", () => {
        timeseries.data = bucketed();

        renderGraph({ ...leaderboard, excludeUnknownBuckets: false });

        const groups = plottedGroups();
        expect(groups.some((label) => label.includes("user-a"))).toBe(true);
        expect(groups.some((label) => label.includes("unknown"))).toBe(true);
      });
    });
  });

  describe("given a read the server refused", () => {
    describe("when the chart renders", () => {
      /** @scenario "A chart that could not be read says so instead of drawing nothing" */
      it("says the read failed and offers a retry rather than drawing an empty plot", () => {
        timeseries.error = {
          message: "query_timeout",
          data: { error: { code: "query_timeout", httpStatus: 500 } },
        };

        renderGraph(leaderboard);

        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
        // The wire message is the code slug; it must never reach the reader.
        expect(screen.queryByText("query_timeout")).not.toBeInTheDocument();
      });
    });
  });
});
