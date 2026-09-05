/**
 * @vitest-environment jsdom
 *
 * Integration tests for ExternalSetDetailPanel: a run row opens the drawer
 * rather than navigating to a page of its own.
 *
 * @see specs/features/suites/suite-bugfixes-1956.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockRunDataQuery = vi.hoisted(() => vi.fn());

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("@langwatch/trace-web/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

vi.mock("@langwatch/trace-web/hooks/usePageVisibility", () => ({
  usePageVisibility: () => true,
}));

vi.mock("@langwatch/trace-web/hooks/useSSESubscription", () => ({
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

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
    setFlowCallbacks: vi.fn(),
    getFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => ({}),
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({ push: mockRouterPush, query: {}, isReady: true }),
}));

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn(), setData: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getSuiteRunData: { useQuery: mockRunDataQuery },
      getSuiteRunFreshness: { useQuery: vi.fn(() => ({ data: undefined })) },
      getAll: { useQuery: () => ({ data: undefined, isLoading: false, error: null }) },
      cancelJob: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      cancelBatchRun: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      onSimulationUpdate: {},
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
  },
}));

import { ExternalSetDetailPanel } from "../external-set-detail-panel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const period = {
  startDate: new Date("2025-01-01"),
  endDate: new Date("2025-01-31"),
};

describe("<ExternalSetDetailPanel/>", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given an external set with one run", () => {
    describe("when the run row is clicked", () => {
      /** @scenario "Clicking a run in external set detail opens the drawer" */
      it("opens the drawer instead of navigating to a new page", () => {
        mockRunDataQuery.mockReturnValue({
          data: {
            runs: [
              {
                batchRunId: "batch_1",
                scenarioRunId: "run_1",
                scenarioId: "scen_1",
                status: "SUCCESS",
                timestamp: Date.now(),
                results: null,
                messages: [],
                name: "Test Scenario",
                description: null,
                durationInMs: 100,
              },
            ],
            scenarioSetIds: {},
            hasMore: false,
          },
          isLoading: false,
          error: null,
        });

        render(<ExternalSetDetailPanel scenarioSetId="ext-set-1" period={period} />, {
          wrapper: Wrapper,
        });

        fireEvent.click(screen.getByLabelText(/View details for/));

        expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
          urlParams: { scenarioRunId: "run_1" },
        });
        expect(mockRouterPush).not.toHaveBeenCalled();
      });
    });
  });
});
