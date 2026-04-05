/**
 * @vitest-environment jsdom
 *
 * Integration tests for single loading indicator on suites page (Issue #1904).
 *
 * Verifies skeleton placeholders replace the double spinner, main panel is
 * suppressed during sidebar load, and RunHistoryPanel spinner works independently.
 *
 * @see specs/features/suites/single-loading-indicator.feature
 */
import { ChakraProvider, Spinner, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSuitesQuery = vi.fn();
let allRunsPanelLoading = false;

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      suites: { getAll: { invalidate: vi.fn() }, getSummaries: { invalidate: vi.fn() } },
    }),
    suites: {
      getAll: { useQuery: (...args: unknown[]) => mockSuitesQuery(...args) },
      getSummaries: { useQuery: () => ({ data: {}, isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      run: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scenarios: {
      getSuiteRunData: {
        useQuery: () => ({
          data: { runs: [], scenarioSetIds: {}, hasMore: false },
          isLoading: false,
          error: null,
        }),
      },
      getExternalSetSummaries: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      getAll: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      cancelJob: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      cancelBatchRun: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "my-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    setFlowCallbacks: vi.fn(),
  }),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    pathname: "/[project]/simulations/[[...path]]",
    asPath: "/my-project/simulations",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => {},
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

vi.mock("~/components/suites/RunHistoryPanel", () => ({
  RunHistoryPanel: () => {
    if (allRunsPanelLoading) {
      return (
        <div data-testid="all-runs-panel">
          <Spinner data-testid="all-runs-spinner" />
        </div>
      );
    }
    return <div data-testid="all-runs-panel">All Runs Panel</div>;
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

async function importSuitesPage(): Promise<React.ComponentType> {
  const mod = await import("~/components/suites/SimulationsPage");
  return mod.default;
}

describe("Single loading indicator on suites page (Issue #1904)", () => {
  let SuitesPage: React.ComponentType;

  beforeEach(async () => {
    SuitesPage = await importSuitesPage();
    allRunsPanelLoading = false;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when suites data has not yet loaded", () => {
    beforeEach(() => {
      mockSuitesQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });
    });

    it("displays skeleton placeholder rows in the sidebar", () => {
      render(<SuitesPage />, { wrapper: Wrapper });

      const skeletons = screen.getAllByTestId("suite-sidebar-skeleton");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("does not show a spinner", () => {
      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.queryAllByRole("status")).toHaveLength(0);
    });

    it("renders the All Runs panel while sidebar loads", () => {
      render(<SuitesPage />, { wrapper: Wrapper });

      // The All Runs panel shows immediately — it fetches data independently
      expect(screen.queryByTestId("all-runs-panel")).toBeInTheDocument();
    });
  });

  describe("when sidebar data has loaded", () => {
    beforeEach(() => {
      mockSuitesQuery.mockReturnValue({
        data: [
          {
            id: "suite_1",
            projectId: "project_1",
            name: "My Suite",
            slug: "my-suite",
            description: null,
            scenarioIds: [],
            targets: [],
            repeatCount: 1,
            labels: [],
            archivedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        isLoading: false,
        error: null,
      });
    });

    it("displays the suite list in the sidebar", () => {
      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.getByText("My Suite")).toBeInTheDocument();
    });

    // Default route (no ?suite= param) resolves to ALL_RUNS_ID via useSuiteRouting
    it("renders the main panel when sidebar is done loading", () => {
      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.getByTestId("all-runs-panel")).toBeInTheDocument();
    });

    describe("when main panel data is still loading", () => {
      it("displays a loading indicator in the main panel", () => {
        allRunsPanelLoading = true;

        render(<SuitesPage />, { wrapper: Wrapper });

        expect(screen.getByText("My Suite")).toBeInTheDocument();
        expect(screen.getByTestId("all-runs-spinner")).toBeInTheDocument();
      });
    });
  });
});
