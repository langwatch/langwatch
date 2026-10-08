/** @vitest-environment jsdom */

/**
 * What the analytics panels send: a chart that does not draw the previous
 * period asks the backend to skip it, and the documents section's panels read
 * one shared window so they share one cached request.
 */

import { Tabs } from "@langwatch/design-system/primitives";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  timeseries: [] as Record<string, unknown>[],
  documents: [] as Record<string, unknown>[],
  filterParamsCall: 0,
}));

const loadingQuery = vi.hoisted(() => ({
  data: undefined,
  error: null,
  isLoading: true,
  isError: false,
  isFetching: true,
  refetch: () => undefined,
}));

vi.mock("@langwatch/browser-host/read-freshness", () => ({
  useReadFreshness: () => ({ asOf: null, confirmed: true }),
}));

vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    analytics: {
      getTimeseries: {
        useQuery: (input: Record<string, unknown>) => {
          captured.timeseries.push(input);
          return loadingQuery;
        },
      },
      topUsedDocuments: {
        useQuery: (input: Record<string, unknown>) => {
          captured.documents.push(input);
          return loadingQuery;
        },
      },
    },
    useUtils: () => ({
      analytics: {
        getTimeseries: { refetch: () => undefined },
        topUsedDocuments: { refetch: () => undefined },
        feedbacks: { refetch: () => undefined },
      },
    }),
  },
}));

vi.mock("../../../behavior/use-filter-params.ts", () => ({
  // Each call anchors its window to its own "now", like the real hook.
  useFilterParams: () => ({
    filterParams: {
      projectId: "proj-1",
      startDate: 0,
      endDate: 1_000 + captured.filterParamsCall++,
      filters: {},
    },
    queryOpts: { enabled: true },
  }),
}));

import type { TopUsedDocumentsParams } from "../../../behavior/use-analytics-documents.ts";
import { renderWithAnalyticsHost } from "../../../testing.tsx";
import { CustomGraph, type CustomGraphInput } from "../custom-graph.tsx";
import { DocumentsCountsSummary, DocumentsCountsTable } from "../documents-counts-table.tsx";

afterEach(cleanup);

beforeEach(() => {
  captured.timeseries.length = 0;
  captured.documents.length = 0;
});

function graph(overrides: Partial<CustomGraphInput>): CustomGraphInput {
  return {
    graphId: "graph-1",
    graphType: "line",
    series: [
      {
        name: "Traces",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: "colors",
      },
    ],
    includePrevious: false,
    timeScale: 1440,
    ...overrides,
  };
}

/** The input of the panel's main query (the first getTimeseries call). */
function mainQueryInput() {
  return captured.timeseries[0];
}

describe("<CustomGraph /> previous period", () => {
  describe("when a line chart does not show the previous period", () => {
    /** @scenario "A panel that hides the previous period does not scan it" */
    it("asks the backend to skip it", () => {
      renderWithAnalyticsHost(<CustomGraph input={graph({ includePrevious: false })} />);

      expect(mainQueryInput()?.shouldSkipPreviousPeriod).toBe(true);
    });
  });

  describe("when a line chart shows the previous period", () => {
    it("asks for it", () => {
      renderWithAnalyticsHost(<CustomGraph input={graph({ includePrevious: true })} />);

      expect(mainQueryInput()?.shouldSkipPreviousPeriod).toBe(false);
    });
  });

  describe("when a summary chart has includePrevious off", () => {
    it("still asks for the previous period, which the summary always shows", () => {
      renderWithAnalyticsHost(
        <CustomGraph input={graph({ graphType: "summary", includePrevious: false })} />,
      );

      expect(mainQueryInput()?.shouldSkipPreviousPeriod).toBe(false);
    });
  });
});

describe("documents section panels", () => {
  describe("when the summary and the table get the section's params", () => {
    /** @scenario "The documents section sends one request per window" */
    it("query with the same input, so they share one cached request", () => {
      const params: TopUsedDocumentsParams = {
        filterParams: { projectId: "proj-1", startDate: 0, endDate: 42, filters: {} },
        queryOpts: { enabled: true, refetchOnMount: false, refetchOnWindowFocus: false },
      };

      renderWithAnalyticsHost(
        <Tabs.Root defaultValue="docs">
          <Tabs.List>
            <Tabs.Trigger value="docs">
              <DocumentsCountsSummary params={params} />
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="docs">
            <DocumentsCountsTable params={params} />
          </Tabs.Content>
        </Tabs.Root>,
      );

      expect(captured.documents.length).toBeGreaterThanOrEqual(2);
      for (const input of captured.documents) {
        expect(input).toEqual(params.filterParams);
      }
    });
  });
});
