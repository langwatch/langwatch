/**
 * @vitest-environment jsdom
 *
 * The run history is a live view, and the period's upper bound is not.
 *
 * `usePeriodSelector` builds a relative preset as `endDate: now` and its
 * useMemo deliberately excludes `now` from its deps, so `period.endDate` is
 * pinned at mount. Sending that to the list query filters on
 * `StartedAt <= <page load>`, and a run started after the page opened never
 * appears — on the one surface whose job is watching runs happen.
 *
 * Asserted on the query input rather than on rendered rows, because the bound
 * is applied in ClickHouse: by the time the component renders, the missing run
 * is indistinguishable from a run that does not exist.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

import { RunHistoryPanel } from "../RunHistoryPanel";

const mockGetSuiteRunData = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getSuiteRunData: { useQuery: mockGetSuiteRunData },
      getSuiteRunFreshness: { useQuery: vi.fn(() => ({ data: undefined })) },
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
      cancelJob: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      cancelBatchRun: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
    },
    agents: { getAll: { useQuery: vi.fn(() => ({ data: [] })) } },
    prompts: {
      getAllPromptsForProject: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    export: {
      onScenarioRunExportProgress: { useSubscription: vi.fn() },
    },
  },
}));

vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: vi.fn(() => ({
    connectionState: "disconnected",
    isConnected: false,
    isConnecting: false,
    hasError: false,
    isDisconnected: true,
    retryCount: 0,
    lastData: undefined,
    lastError: undefined,
  })),
}));

vi.mock("~/hooks/usePageVisibility", () => ({ usePageVisibility: () => true }));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), isReady: true }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const scenarioSetId = "__internal__suite_1__suite";

describe("<RunHistoryPanel/> run-history window", () => {
  beforeEach(() => {
    mockGetSuiteRunData.mockReturnValue({
      data: { runs: [], scenarioSetIds: {}, hasMore: false, changed: true },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a relative period whose end was pinned when the page loaded", () => {
    it("queries the run list with no upper bound, so later runs still arrive", () => {
      const pinnedEnd = new Date("2024-06-15T12:00:00Z");

      render(
        <RunHistoryPanel
          scenarioSetId={scenarioSetId}
          period={{
            startDate: new Date("2024-05-16T12:00:00Z"),
            endDate: pinnedEnd,
          }}
        />,
        { wrapper: Wrapper },
      );

      const [listQueryInput] = mockGetSuiteRunData.mock.calls[0] as [
        { startDate?: number; endDate?: number },
      ];

      expect(listQueryInput.startDate).toBe(
        new Date("2024-05-16T12:00:00Z").getTime(),
      );
      // The bound the router would otherwise default to Date.now() per request.
      expect(listQueryInput.endDate).toBeUndefined();
    });
  });
});
