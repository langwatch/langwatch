/**
 * @vitest-environment jsdom
 *
 * Integration tests for "All Runs" default selection on the Suites page.
 *
 * @see specs/features/suites/all-runs-default-open.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the archive mutation's onSuccess so tests can trigger it manually
let capturedArchiveOnSuccess: (() => void) | undefined;

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      suites: { getAll: { invalidate: vi.fn() } },
    }),
    suites: {
      getAll: {
        useQuery: () => ({
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
        }),
      },
      archive: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          capturedArchiveOnSuccess = opts.onSuccess;
          return {
            mutate: vi.fn(),
            isPending: false,
          };
        },
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

const mockPush = vi.fn();
let mockRouterQuery: Record<string, string | string[] | undefined> = { project: "my-project" };

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    asPath: mockRouterQuery.suite
      ? `/my-project/simulations/suites?suite=${mockRouterQuery.suite as string}`
      : "/my-project/simulations/suites",
    push: mockPush,
    isReady: true,
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

// Mock panels to avoid deep dependency trees
vi.mock("~/components/suites/AllRunsPanel", () => ({
  AllRunsPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
}));

vi.mock("~/components/suites/SuiteDetailPanel", () => ({
  SuiteDetailPanel: ({ suite }: { suite: { name: string } }) => (
    <div data-testid="suite-detail-panel">{suite.name}</div>
  ),
  SuiteEmptyState: () => <div data-testid="suite-empty-state">Empty</div>,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("All Runs default selection (Issue #1771)", () => {
  beforeEach(() => {
    mockRouterQuery = { project: "my-project" };
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
    capturedArchiveOnSuccess = undefined;
    vi.restoreAllMocks();
  });

  describe("when the page loads with no suite param in URL", () => {
    it("selects 'All Runs' as the default sidebar item and displays the All Runs panel", async () => {
      mockRouterQuery = { project: "my-project" };

      const { default: SuitesPage } = await import(
        "~/pages/[project]/simulations/suites/index"
      );

      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.getByTestId("all-runs-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("suite-detail-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("suite-empty-state")).not.toBeInTheDocument();
    });
  });

  describe("when the user archives the selected suite", () => {
    it("navigates to all-runs after archiving", async () => {
      // Start with a suite selected in the URL
      mockRouterQuery = { project: "my-project", suite: "my-suite" };

      const { default: SuitesPage } = await import(
        "~/pages/[project]/simulations/suites/index"
      );

      render(<SuitesPage />, { wrapper: Wrapper });

      const user = userEvent.setup();

      // Suite detail panel is shown
      expect(screen.getByTestId("suite-detail-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("all-runs-panel")).not.toBeInTheDocument();

      // Open context menu on the suite and click "Archive" to set archiveConfirmId
      const suiteTexts = screen.getAllByText("My Suite");
      act(() => {
        fireEvent.contextMenu(suiteTexts[0]!);
      });
      await user.click(screen.getByText("Archive"));

      // Simulate the archive mutation's onSuccess callback
      act(() => {
        capturedArchiveOnSuccess?.();
      });

      // Archiving the currently selected suite navigates to all-runs
      expect(mockPush).toHaveBeenCalledWith(
        {
          pathname: "/[project]/simulations/suites",
          query: { project: "my-project" },
        },
        "/my-project/simulations/suites",
        { shallow: true },
      );
    });
  });
});
