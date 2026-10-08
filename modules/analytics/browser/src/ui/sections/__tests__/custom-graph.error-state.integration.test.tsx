/** @vitest-environment jsdom */

/**
 * A failed analytics panel stays inside its own bounds: a chart panel draws the
 * compact message with a Retry, and a figure inside a tab header draws only an
 * indicator, since a tab trigger is a button and cannot hold another one.
 */

import { Tabs } from "@langwatch/design-system/primitives";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const queryState = vi.hoisted(() => ({
  timeseries: {} as Record<string, unknown>,
  documents: {} as Record<string, unknown>,
}));

const refetches = vi.hoisted(() => ({
  timeseries: vi.fn(),
  documents: vi.fn(),
  feedbacks: vi.fn(),
}));

vi.mock("@langwatch/browser-host/read-freshness", () => ({
  useReadFreshness: () => ({ asOf: null, confirmed: true }),
}));

vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    analytics: {
      getTimeseries: { useQuery: () => queryState.timeseries },
      topUsedDocuments: { useQuery: () => queryState.documents },
    },
    useUtils: () => ({
      analytics: {
        getTimeseries: { refetch: refetches.timeseries },
        topUsedDocuments: { refetch: refetches.documents },
        feedbacks: { refetch: refetches.feedbacks },
      },
    }),
  },
}));

vi.mock("../../../behavior/use-filter-params.ts", () => ({
  useFilterParams: () => ({
    filterParams: { projectId: "proj-1", startDate: 0, endDate: 1, filters: {} },
    queryOpts: { enabled: true },
  }),
}));

import { FAILED_ACTIVE_QUERIES } from "../../../behavior/analytics-feedback.ts";
import { renderWithAnalyticsHost } from "../../../testing.tsx";
import { CustomGraph, type CustomGraphInput } from "../custom-graph.tsx";
import { DocumentsCountsSummary, DocumentsCountsTable } from "../documents-counts-table.tsx";

afterEach(cleanup);

beforeEach(() => {
  refetches.timeseries.mockReset();
  refetches.documents.mockReset();
  refetches.feedbacks.mockReset();
});

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

/** The tRPC error a panel query receives when the search ran out of memory. */
const searchTooLarge = {
  message: "query_memory_exceeded",
  data: {
    httpStatus: 422,
    error: {
      code: "query_memory_exceeded",
      httpStatus: 422,
      fault: "customer",
      traceId: TRACE_ID,
      tips: [
        "Add filters to reduce the amount of data scanned",
        "Request fewer attribute or metadata fields",
      ],
    },
  },
};

function failedQuery() {
  return {
    data: undefined,
    error: searchTooLarge,
    isLoading: false,
    isError: true,
    isFetching: false,
    refetch: vi.fn(),
  };
}

const lineGraph: CustomGraphInput = {
  graphId: "llmCallsGraph",
  graphType: "line",
  series: [
    {
      name: "LLM Calls",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      colorSet: "colors",
    },
  ],
  includePrevious: true,
  timeScale: 1,
};

describe("<CustomGraph />", () => {
  describe("given a chart panel", () => {
    describe("when its query fails", () => {
      beforeEach(() => {
        queryState.timeseries = failedQuery();
      });

      /** @scenario "A failed chart panel shows a compact message and a Retry" */
      it("shows the registry headline, one line of advice and a Retry, without the tips list", () => {
        renderWithAnalyticsHost(<CustomGraph input={lineGraph} />);

        const alert = screen.getByRole("alert");
        expect(within(alert).getByText("This search was too large")).toBeInTheDocument();
        expect(
          within(alert).getByText("Narrow the time range, add a filter, or select fewer fields."),
        ).toBeInTheDocument();
        expect(within(alert).getByRole("button", { name: /retry/i })).toBeInTheDocument();
        expect(
          screen.queryByText("Add filters to reduce the amount of data scanned"),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("list")).not.toBeInTheDocument();
        expect(screen.queryByText("query_memory_exceeded")).not.toBeInTheDocument();
      });

      /** @scenario "A failed chart panel shows a compact message and a Retry" */
      it("keeps the error id reachable as a small copy action", () => {
        renderWithAnalyticsHost(<CustomGraph input={lineGraph} />);

        const alert = screen.getByRole("alert");
        expect(within(alert).getByTitle(`Error ID: ${TRACE_ID}`)).toBeInTheDocument();
      });

      /** @scenario "Retry in a panel refetches every failed analytics panel" */
      it("refetches the failed analytics queries when Retry is clicked", async () => {
        const user = userEvent.setup();
        renderWithAnalyticsHost(<CustomGraph input={lineGraph} />);

        await user.click(screen.getByRole("button", { name: /retry/i }));

        for (const refetch of [refetches.timeseries, refetches.documents, refetches.feedbacks]) {
          expect(refetch).toHaveBeenCalledExactlyOnceWith(undefined, FAILED_ACTIVE_QUERIES);
        }
      });
    });
  });

  describe("given a summary drawn inside a tab header", () => {
    function renderSummaryInTab() {
      return renderWithAnalyticsHost(
        <Tabs.Root defaultValue="llmCalls">
          <Tabs.List>
            <Tabs.Trigger value="llmCalls">
              <CustomGraph input={{ ...lineGraph, graphType: "summary" }} />
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="llmCalls" />
        </Tabs.Root>,
      );
    }

    describe("when its query fails", () => {
      beforeEach(() => {
        queryState.timeseries = failedQuery();
      });

      /** @scenario "A failed summary in a tab header shows a compact indicator" */
      it("shows the figure label with a compact indicator, not the panel card", () => {
        renderSummaryInTab();

        const tab = screen.getByRole("tab");
        expect(within(tab).getByText("LLM Calls")).toBeInTheDocument();
        expect(within(tab).getByTestId("chart-error-indicator")).toBeInTheDocument();
        expect(within(tab).getByText("Couldn't load")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(within(tab).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
      });

      /** @scenario "A failed summary in a tab header shows a compact indicator" */
      it("carries the registry copy for assistive technology, never the code slug", () => {
        renderSummaryInTab();

        const tab = screen.getByRole("tab");
        expect(tab).toHaveTextContent("This search was too large");
        expect(tab).not.toHaveTextContent("query_memory_exceeded");
      });
    });
  });

  describe("given a summary card with several figures", () => {
    describe("when its query fails", () => {
      beforeEach(() => {
        queryState.timeseries = failedQuery();
      });

      /** @scenario "A failed summary card shows one compact indicator" */
      it("shows one compact indicator for the whole row, not one per figure", () => {
        const series = lineGraph.series[0]!;
        renderWithAnalyticsHost(
          <CustomGraph
            input={{
              ...lineGraph,
              graphType: "summary",
              series: [
                series,
                {
                  ...series,
                  name: "Total Cost",
                  metric: "performance.total_cost",
                  aggregation: "sum",
                },
                {
                  ...series,
                  name: "Tokens",
                  metric: "performance.total_tokens",
                  aggregation: "sum",
                },
              ],
            }}
          />,
        );

        expect(screen.getAllByTestId("chart-error-indicator")).toHaveLength(1);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });
    });
  });
});

describe("<DocumentsCountsTable />", () => {
  describe("when its query fails", () => {
    beforeEach(() => {
      queryState.documents = failedQuery();
    });

    /** @scenario "Top used documents shows the same compact error state" */
    it("shows the compact panel message with a Retry", async () => {
      const user = userEvent.setup();
      renderWithAnalyticsHost(<DocumentsCountsTable />);

      const alert = screen.getByRole("alert");
      expect(within(alert).getByText("This search was too large")).toBeInTheDocument();
      expect(screen.queryByText("An error occurred")).not.toBeInTheDocument();

      await user.click(within(alert).getByRole("button", { name: /retry/i }));
      expect(refetches.documents).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Top used documents shows the same compact error state" */
    it("shows the compact indicator in the total documents tab header", () => {
      renderWithAnalyticsHost(<DocumentsCountsSummary />);

      expect(screen.getByTestId("chart-error-indicator")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
