/**
 * @vitest-environment jsdom
 *
 * Integration tests for "All Runs" default selection on the Suites page.
 *
 * @see specs/features/suites/all-runs-default-open.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the delete mutation's onSuccess so tests can trigger it manually
let capturedDeleteOnSuccess: (() => void) | undefined;

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
      delete: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          capturedDeleteOnSuccess = opts.onSuccess;
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

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    asPath: "/my-project/suites",
    push: vi.fn(),
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
  afterEach(() => {
    cleanup();
    capturedDeleteOnSuccess = undefined;
    vi.restoreAllMocks();
  });

  describe("when the page loads", () => {
    it("selects 'All Runs' as the default sidebar item and displays the All Runs panel", async () => {
      const { default: SuitesPage } = await import(
        "~/pages/[project]/simulations/suites/index"
      );

      render(<SuitesPage />, { wrapper: Wrapper });

      expect(screen.getByTestId("all-runs-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("suite-detail-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("suite-empty-state")).not.toBeInTheDocument();
    });
  });

  describe("when the user deletes the selected suite", () => {
    it("falls back to 'All Runs' and displays the All Runs panel", async () => {
      const { default: SuitesPage } = await import(
        "~/pages/[project]/simulations/suites/index"
      );

      render(<SuitesPage />, { wrapper: Wrapper });

      // Select a suite by clicking its name in the sidebar
      act(() => {
        screen.getByText("My Suite").click();
      });

      // Suite detail panel is now shown instead of All Runs
      expect(screen.getByTestId("suite-detail-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("all-runs-panel")).not.toBeInTheDocument();

      // Open context menu on the suite and click "Delete" to set deleteConfirmId
      const suiteTexts = screen.getAllByText("My Suite");
      act(() => {
        fireEvent.contextMenu(suiteTexts[0]!);
      });
      act(() => {
        screen.getByText("Delete").click();
      });

      // Simulate the delete mutation's onSuccess callback
      // (bypasses the Chakra dialog which doesn't render properly in JSDOM)
      act(() => {
        capturedDeleteOnSuccess?.();
      });

      // All Runs panel is back after deletion
      expect(screen.getByTestId("all-runs-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("suite-detail-panel")).not.toBeInTheDocument();
    });
  });
});
