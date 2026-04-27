/**
 * @vitest-environment jsdom
 *
 * Integration tests for simulation page URL routing.
 *
 * Verifies that selection is driven by URL path segments:
 *   /simulations                              → All Runs
 *   /simulations/run-plans/:suiteSlug         → Suite detail
 *   /simulations/:externalSetSlug             → External set
 *   /simulations/:externalSetSlug/:batchId    → External set + highlight
 *
 * @see specs/suites/simulation-runs-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

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

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockQuery: Record<string, string | string[] | undefined> = { project: "my-project" };
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    pathname: "/[project]/simulations/[[...path]]",
    asPath: "/my-project/simulations",
    push: mockPush,
    replace: mockReplace,
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

const mockSuites = [
  {
    id: "suite_a",
    projectId: "project_1",
    name: "Suite A",
    slug: "suite-a",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "suite_b",
    projectId: "project_1",
    name: "Suite B",
    slug: "suite-b",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

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
          data: mockSuites,
          isLoading: false,
          error: null,
        }),
      },
      getSummaries: {
        useQuery: () => ({ data: {}, isLoading: false }),
      },
      archive: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: () => opts.onSuccess?.(),
          isPending: false,
        }),
      },
      duplicate: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      run: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
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
        useQuery: () => ({
          data: [{ scenarioSetId: "python-examples", passedCount: 5, failedCount: 1, totalCount: 6, lastRunTimestamp: Date.now() }],
          isLoading: false,
          error: null,
        }),
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

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

vi.mock("~/components/suites/RunHistoryPanel", () => ({
  RunHistoryPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
}));

vi.mock("~/components/suites/SuiteDetailPanel", () => ({
  SuiteDetailPanel: ({ suite }: { suite: { name: string } }) => (
    <div data-testid="suite-detail-panel">{suite.name} details</div>
  ),
  SuiteEmptyState: () => <div data-testid="suite-empty-state">No run plan selected</div>,
}));

vi.mock("~/components/suites/ExternalSetDetailPanel", () => ({
  ExternalSetDetailPanel: ({ scenarioSetId }: { scenarioSetId: string }) => (
    <div data-testid="external-set-panel">{scenarioSetId} details</div>
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

async function renderSimulationsPage() {
  const mod = await import("~/components/suites/SimulationsPage");
  const SimulationsPage = mod.default;
  return render(<SimulationsPage />, { wrapper: Wrapper });
}

describe("Simulation Page URL Routing", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockQuery = { project: "my-project" };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when navigating to /simulations (base path)", () => {
    it("shows the all runs view", async () => {
      await renderSimulationsPage();
      expect(screen.getByTestId("all-runs-panel")).toBeInTheDocument();
    });

    it("displays Simulations heading", async () => {
      await renderSimulationsPage();
      expect(screen.getByText("Simulations")).toBeInTheDocument();
    });

    it("displays New Run Plan button", async () => {
      await renderSimulationsPage();
      expect(screen.getByText(/New Run Plan/)).toBeInTheDocument();
    });
  });

  describe("when navigating to /simulations/run-plans/:suiteSlug", () => {
    it("shows that suite details", async () => {
      mockQuery = { project: "my-project", path: ["run-plans", "suite-a"] };
      await renderSimulationsPage();
      expect(screen.getByTestId("suite-detail-panel")).toBeInTheDocument();
      expect(screen.getByText("Suite A details")).toBeInTheDocument();
    });
  });

  describe("when navigating to /simulations/:externalSetSlug", () => {
    it("shows the external set panel", async () => {
      mockQuery = { project: "my-project", path: ["python-examples"] };
      await renderSimulationsPage();
      expect(screen.getByTestId("external-set-panel")).toBeInTheDocument();
      expect(screen.getByText("python-examples details")).toBeInTheDocument();
    });
  });

  describe("when navigating to a non-existent suite slug", () => {
    it("shows the empty state", async () => {
      mockQuery = { project: "my-project", path: ["run-plans", "non-existent-slug"] };
      await renderSimulationsPage();
      expect(screen.getByTestId("suite-empty-state")).toBeInTheDocument();
    });
  });

  describe("when clicking a suite in the sidebar", () => {
    it("navigates with shallow routing", async () => {
      const user = userEvent.setup();
      await renderSimulationsPage();
      await user.click(screen.getByText("Suite A"));

      expect(mockPush).toHaveBeenCalledWith(
        { pathname: "/[project]/simulations/[[...path]]", query: { project: "my-project", path: ["run-plans", "suite-a"] } },
        "/my-project/simulations/run-plans/suite-a",
        { shallow: true },
      );
    });
  });

  describe("when clicking All Runs in the sidebar", () => {
    it("navigates with shallow routing", async () => {
      mockQuery = { project: "my-project", path: ["run-plans", "suite-a"] };
      const user = userEvent.setup();
      await renderSimulationsPage();
      await user.click(screen.getByText("All Runs"));

      expect(mockPush).toHaveBeenCalledWith(
        { pathname: "/[project]/simulations/[[...path]]", query: { project: "my-project" } },
        "/my-project/simulations",
        { shallow: true },
      );
    });
  });
});
