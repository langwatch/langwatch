/**
 * @vitest-environment jsdom
 *
 * Integration tests for Suites page layout consistency (Issue #1671).
 *
 * Verifies PageLayout.Header with Heading, no duplicate label in sidebar,
 * sidebar fills available height, and DashboardLayout renders once.
 *
 * @see specs/suites/suite-workflow.feature - "Layout Consistency (Issue #1671)"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulationSuite } from "@prisma/client";

vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: () => ({
    connectionState: "connected",
    isConnected: true,
    isConnecting: false,
    hasError: false,
    isDisconnected: false,
    retryCount: 0,
    lastData: undefined,
    lastError: undefined,
  }),
}));

// Mock tRPC api
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      suites: {
        getAll: { invalidate: vi.fn() },
        getSummaries: { invalidate: vi.fn() },
      },
    }),
    suites: {
      getAll: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: null,
        }),
      },
      getSummaries: { useQuery: () => ({ data: {}, isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      run: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scenarios: {
      getSuiteRunData: {
        useQuery: () => ({
          data: { runs: [], scenarioSetIds: {}, hasMore: false, nextCursor: undefined },
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

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "my-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    setFlowCallbacks: vi.fn(),
  }),
}));

// Mock next/router
vi.mock("~/utils/compat/next-router", () => ({
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

// Track DashboardLayout render count
let dashboardLayoutRenderCount = 0;
vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => {
    dashboardLayoutRenderCount++;
    return <div data-testid="dashboard-layout">{children}</div>;
  },
}));

// Mock RunHistoryPanel to avoid deep dependency tree (now renders by default)
vi.mock("~/components/suites/RunHistoryPanel", () => ({
  RunHistoryPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
}));

// We import after mocks are set up
import { SuiteSidebar } from "../SuiteSidebar";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeSuite(
  overrides: Partial<SimulationSuite> = {},
): SimulationSuite {
  return {
    id: "suite_1",
    projectId: "project_1",
    name: "Critical Path",
    slug: "critical-path",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Suites Page Layout (Issue #1671)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    dashboardLayoutRenderCount = 0;
  });

  describe("when rendering the suites page", () => {
    it("renders PageLayout.Header with a 'Simulations' heading", async () => {
      // Dynamic import to ensure mocks are applied
      const { default: SimulationsPage } = await import(
        "~/components/suites/SimulationsPage"
      );

      render(<SimulationsPage />, { wrapper: Wrapper });

      const heading = screen.getByRole("heading", { name: "Simulations" });
      expect(heading).toBeInTheDocument();
    });

    it("does not render DashboardLayout twice", async () => {
      dashboardLayoutRenderCount = 0;
      const { default: SimulationsPage } = await import(
        "~/components/suites/SimulationsPage"
      );

      render(<SimulationsPage />, { wrapper: Wrapper });

      expect(dashboardLayoutRenderCount).toBe(1);
    });

});

  describe("when rendering the SuiteSidebar", () => {
    it("does not render a 'SUITES' section header in the sidebar", () => {
      const suites = [makeSuite()];
      render(
        <SuiteSidebar
          projectSlug="my-project"
          suites={suites}
          selectedSuiteSlug={null}
          onSelectSuite={vi.fn()}
          onRunSuite={vi.fn()}
          onContextMenu={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const suitesLabels = screen.queryAllByText(/^SUITES$/);
      expect(suitesLabels).toHaveLength(0);
    });
  });
});
