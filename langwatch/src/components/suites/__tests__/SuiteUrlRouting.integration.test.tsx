/**
 * @vitest-environment jsdom
 *
 * Integration tests for suite URL routing.
 *
 * Verifies that suite selection is driven by URL, navigation updates URL,
 * and direct navigation to suite URLs works correctly.
 *
 * @see specs/features/suites/suite-url-routing.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const mockPush = vi.fn();
let mockQuery: Record<string, string | string[] | undefined> = { project: "my-project" };

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
    asPath: "/my-project/simulations/suites",
    push: mockPush,
    isReady: true,
  }),
}));

// Mock tRPC api
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

vi.mock("~/components/suites/AllRunsPanel", () => ({
  AllRunsPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
}));

vi.mock("~/components/suites/SuiteDetailPanel", () => ({
  SuiteDetailPanel: ({ suite }: { suite: { name: string } }) => (
    <div data-testid="suite-detail-panel">{suite.name} details</div>
  ),
  SuiteEmptyState: () => <div data-testid="suite-empty-state">No suite selected</div>,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

async function renderSuitesPage() {
  const mod = await import("~/pages/[project]/simulations/suites/[[...suiteId]]");
  const SuitesPage = mod.default;
  return render(<SuitesPage />, { wrapper: Wrapper });
}

describe("Suite URL Routing", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockQuery = { project: "my-project" };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when navigating to base suites URL (no suiteId)", () => {
    it("shows the all runs view", async () => {
      mockQuery = { project: "my-project" };

      await renderSuitesPage();

      expect(screen.getByTestId("all-runs-panel")).toBeInTheDocument();
    });
  });

  describe("when navigating directly to a suite URL", () => {
    it("shows that suite's details", async () => {
      mockQuery = { project: "my-project", suiteId: ["suite_a"] };

      await renderSuitesPage();

      expect(screen.getByTestId("suite-detail-panel")).toBeInTheDocument();
      expect(screen.getByText("Suite A details")).toBeInTheDocument();
    });
  });

  describe("when navigating to a non-existent suite ID", () => {
    it("shows the empty state", async () => {
      mockQuery = { project: "my-project", suiteId: ["non-existent-id"] };

      await renderSuitesPage();

      expect(screen.getByTestId("suite-empty-state")).toBeInTheDocument();
    });
  });

  describe("when clicking a suite in the sidebar", () => {
    it("navigates to the suite URL with shallow routing", async () => {
      mockQuery = { project: "my-project" };
      const user = userEvent.setup();

      await renderSuitesPage();

      await user.click(screen.getByText("Suite A"));

      expect(mockPush).toHaveBeenCalledWith(
        "/my-project/simulations/suites/suite_a",
        undefined,
        { shallow: true },
      );
    });
  });

  describe("when clicking All Runs in the sidebar", () => {
    it("navigates to the base suites URL with shallow routing", async () => {
      mockQuery = { project: "my-project", suiteId: ["suite_a"] };
      const user = userEvent.setup();

      await renderSuitesPage();

      await user.click(screen.getByText("All Runs"));

      expect(mockPush).toHaveBeenCalledWith(
        "/my-project/simulations/suites",
        undefined,
        { shallow: true },
      );
    });
  });
});
