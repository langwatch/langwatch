/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem, Tabs } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const timeseriesInputs: Array<Record<string, unknown>> = [];
const documentsInputs: Array<Record<string, unknown>> = [];

const emptyQuery = {
  data: undefined,
  error: null,
  isLoading: true,
  isFetching: true,
  refetch: vi.fn(),
};

vi.mock("~/utils/api", () => ({
  api: {
    analytics: {
      getTimeseries: {
        useQuery: (input: Record<string, unknown>) => {
          timeseriesInputs.push(input);
          return emptyQuery;
        },
      },
      topUsedDocuments: {
        useQuery: (input: Record<string, unknown>) => {
          documentsInputs.push(input);
          return emptyQuery;
        },
      },
    },
    useUtils: () => ({
      analytics: {
        getTimeseries: { refetch: vi.fn() },
        topUsedDocuments: { refetch: vi.fn() },
        feedbacks: { refetch: vi.fn() },
      },
    }),
  },
}));

let filterParamsCall = 0;
vi.mock("~/hooks/useFilterParams", () => ({
  // Each call anchors its window to its own "now", like the real hook.
  useFilterParams: () => ({
    filterParams: {
      projectId: "project-1",
      startDate: 0,
      endDate: 1_000 + filterParamsCall++,
      filters: {},
    },
    queryOpts: { enabled: true },
  }),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({ daysDifference: 7 }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "my-project" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: {} }),
}));

import { CustomGraph, type CustomGraphInput } from "../CustomGraph";
import {
  DocumentsCountsSummary,
  DocumentsCountsTable,
} from "../DocumentsCountsTable";
import type { TopUsedDocumentsParams } from "../useTopUsedDocuments";

afterEach(cleanup);

beforeEach(() => {
  timeseriesInputs.length = 0;
  documentsInputs.length = 0;
});

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

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
    ] as CustomGraphInput["series"],
    includePrevious: false,
    timeScale: 1440,
    ...overrides,
  };
}

/** The input of the panel's main query (the first getTimeseries call). */
function mainQueryInput() {
  return timeseriesInputs[0];
}

describe("<CustomGraph /> previous period", () => {
  describe("when a line chart does not show the previous period", () => {
    /** @scenario A panel that hides the previous period does not scan it */
    it("asks the backend to skip it", () => {
      renderWithChakra(
        <CustomGraph input={graph({ includePrevious: false })} />,
      );

      expect(mainQueryInput()?.shouldSkipPreviousPeriod).toBe(true);
    });
  });

  describe("when a line chart shows the previous period", () => {
    it("asks for it", () => {
      renderWithChakra(
        <CustomGraph input={graph({ includePrevious: true })} />,
      );

      expect(mainQueryInput()?.shouldSkipPreviousPeriod).toBe(false);
    });
  });

  describe("when a summary chart has includePrevious off", () => {
    it("still asks for the previous period, which the summary always shows", () => {
      renderWithChakra(
        <CustomGraph
          input={graph({ graphType: "summary", includePrevious: false })}
        />,
      );

      expect(mainQueryInput()?.shouldSkipPreviousPeriod).toBe(false);
    });
  });
});

describe("documents section panels", () => {
  describe("when the summary and the table get the section's params", () => {
    /** @scenario The documents section sends one request per window */
    it("query with the same input, so they share one cached request", () => {
      const params = {
        filterParams: {
          projectId: "project-1",
          startDate: 0,
          endDate: 42,
          filters: {},
        },
        queryOpts: { enabled: true },
      } as unknown as TopUsedDocumentsParams;

      renderWithChakra(
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

      expect(documentsInputs.length).toBeGreaterThanOrEqual(2);
      for (const input of documentsInputs) {
        expect(input).toEqual(params.filterParams);
      }
    });
  });
});
