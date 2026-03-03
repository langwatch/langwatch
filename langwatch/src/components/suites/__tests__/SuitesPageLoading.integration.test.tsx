/**
 * @vitest-environment jsdom
 *
 * Integration tests for single loading indicator on suites page (Issue #1904).
 *
 * Verifies skeleton placeholders replace the double spinner, main panel is
 * suppressed during sidebar load, and AllRunsPanel spinner works independently.
 *
 * @see specs/features/suites/single-loading-indicator.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockSuitesQuery = vi.fn();
const mockAllRunsPanel = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      suites: { getAll: { invalidate: vi.fn() } },
    }),
    suites: {
      getAll: { useQuery: (...args: unknown[]) => mockSuitesQuery(...args) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      run: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scenarios: {
      getAllSuiteRunData: {
        useQuery: () => ({
          data: { runs: [], scenarioSetIds: {}, hasMore: false },
          isLoading: false,
          error: null,
        }),
      },
      getAll: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
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
    asPath: "/my-project/simulations/suites",
    push: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

vi.mock("~/components/suites/AllRunsPanel", () => ({
  AllRunsPanel: () => {
    mockAllRunsPanel();
    return <div data-testid="all-runs-panel">All Runs Panel</div>;
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Hoist the dynamic import so mocks are reliably applied
let SuitesPage: React.ComponentType;

describe("Single loading indicator on suites page (Issue #1904)", () => {
  beforeEach(async () => {
    const mod = await import(
      "~/pages/[project]/simulations/suites/index"
    );
    SuitesPage = mod.default;
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

    it("does not show a Chakra Spinner component", () => {
      render(<SuitesPage />, { wrapper: Wrapper });

      const spinners = document.querySelectorAll(".chakra-spinner");
      expect(spinners).toHaveLength(0);
    });

    it("does not render the main panel", () => {
      mockAllRunsPanel.mockClear();
      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.queryByTestId("all-runs-panel")).not.toBeInTheDocument();
      expect(mockAllRunsPanel).not.toHaveBeenCalled();
    });
  });

  describe("when sidebar data has loaded", () => {
    it("displays the suite list in the sidebar", () => {
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

      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.getByText("My Suite")).toBeInTheDocument();
    });

    it("renders the main panel (AllRunsPanel) when sidebar is done loading", () => {
      mockSuitesQuery.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });

      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.queryByTestId("all-runs-panel")).toBeInTheDocument();
    });
  });
});
