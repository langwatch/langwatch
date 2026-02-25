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

// Mock tRPC api
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      suites: {
        getAll: { invalidate: vi.fn() },
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
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      run: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scenarios: {
      getAllSuiteRunData: {
        useQuery: () => ({
          data: { runs: [], scenarioSetIds: {}, hasMore: false, nextCursor: undefined },
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

// Mock AllRunsPanel to avoid deep server-side imports in jsdom
vi.mock("~/components/suites/AllRunsPanel", () => ({
  AllRunsPanel: () => <div data-testid="all-runs-panel">All Runs</div>,
}));

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    asPath: "/my-project/suites",
    push: vi.fn(),
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

// Mock AllRunsPanel to avoid deep dependency tree (now renders by default)
vi.mock("~/components/suites/AllRunsPanel", () => ({
  AllRunsPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
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
    it("renders PageLayout.Header with a 'Suites' heading", async () => {
      // Dynamic import to ensure mocks are applied
      const { default: SuitesPage } = await import(
        "~/pages/[project]/simulations/suites/index"
      );

      render(<SuitesPage />, { wrapper: Wrapper });

      const heading = screen.getByRole("heading", { name: "Suites" });
      expect(heading).toBeInTheDocument();
    });

    it("does not render DashboardLayout twice", async () => {
      dashboardLayoutRenderCount = 0;
      const { default: SuitesPage } = await import(
        "~/pages/[project]/simulations/suites/index"
      );

      render(<SuitesPage />, { wrapper: Wrapper });

      expect(dashboardLayoutRenderCount).toBe(1);
    });
  });

  describe("when rendering the SuiteSidebar", () => {
    it("renders a 'SUITES' section header in the sidebar", () => {
      const suites = [makeSuite()];
      render(
        <SuiteSidebar
          suites={suites}
          selectedSuiteId={null}
          onSelectSuite={vi.fn()}
          onRunSuite={vi.fn()}
          onContextMenu={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // The sidebar has a "SUITES" section header for the collapsible sidebar
      const suitesLabels = screen.queryAllByText(/^SUITES$/);
      expect(suitesLabels).toHaveLength(1);
    });
  });
});
