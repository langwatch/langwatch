/**
 * @vitest-environment jsdom
 *
 * Integration tests for ExternalSetDetailPanel component.
 *
 * Verifies that clicking a run row opens the drawer instead of navigating.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalSetDetailPanel } from "../ExternalSetDetailPanel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Hoisted mocks
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockRunDataQuery = vi.hoisted(() => vi.fn());

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
    currentDrawer: undefined,
    setFlowCallbacks: vi.fn(),
    getFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    query: {},
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      getAllScenarioSetRunData: {
        useQuery: mockRunDataQuery,
      },
    },
  },
}));

describe("<ExternalSetDetailPanel/>", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when clicking a scenario run row", () => {
    it("opens the drawer instead of navigating to a new page", () => {
      const runs = [
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
      ];

      mockRunDataQuery.mockReturnValue({
        data: runs,
        isLoading: false,
        error: null,
      });

      render(<ExternalSetDetailPanel scenarioSetId="ext-set-1" />, { wrapper: Wrapper });

      // Expand the batch run row first
      const runRowHeader = screen.getByTestId("run-row-header");
      fireEvent.click(runRowHeader);

      // Click the scenario run card inside the expanded row
      const scenarioCard = screen.getByLabelText(/View details for/);
      fireEvent.click(scenarioCard);

      expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
        urlParams: { scenarioRunId: "run_1" },
      });
      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });

  describe("given loading state", () => {
    it("displays loading spinner", () => {
      mockRunDataQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      const { container } = render(<ExternalSetDetailPanel scenarioSetId="ext-set-1" />, {
        wrapper: Wrapper,
      });

      expect(container.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });
});
