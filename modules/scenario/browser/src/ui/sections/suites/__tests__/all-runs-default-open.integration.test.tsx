import type * as actualModule from "@langwatch/browser-host/sse-subscription";
/**
 * Integration tests for "All Runs" default selection on the Suites page.
 * @vitest-environment jsdom
 * @see specs/features/suites/all-runs-default-open.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("@langwatch/browser-host/sse-subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof actualModule>();
  return {
    ...actual,
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
  };
});

// Capture the archive mutation's onSuccess so tests can trigger it manually
let capturedArchiveOnSuccess: (() => void) | undefined;

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    featureFlag: {
      isEnabled: {
        useQuery: () => ({ data: { enabled: false }, isLoading: false }),
      },
    },
    useUtils: () => ({
      suites: {
        getAll: { invalidate: vi.fn() },
        getSummaries: { invalidate: vi.fn() },
      },
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
              simulatorModel: null,
              judgeModel: null,
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
      getSummaries: {
        useQuery: () => ({ data: {}, isLoading: false }),
      },
      run: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getExternalSetSummaries: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      getSuiteRunData: {
        useQuery: () => ({
          data: {
            runs: [],
            scenarioSetIds: {},
            hasMore: false,
            nextCursor: undefined,
          },
          isLoading: false,
          error: null,
        }),
      },
      getExternalSetSummaries: {
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

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "my-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    setFlowCallbacks: vi.fn(),
  }),
}));

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockRouterQuery: Record<string, string | string[] | undefined> = {
  project: "my-project",
};
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    pathname: "/[project]/simulations/[[...path]]",
    asPath: "/my-project/simulations",
    push: mockPush,
    replace: mockReplace,
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

// Mock panels to avoid deep dependency trees
vi.mock("../run-history-panel.tsx", () => ({
  RunHistoryPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
}));

vi.mock("../suite-detail-panel.tsx", () => ({
  SuiteDetailPanel: ({ suite }: { suite: { name: string } }) => (
    <div data-testid="suite-detail-panel">{suite.name}</div>
  ),
  SuiteEmptyState: () => <div data-testid="suite-empty-state">Empty</div>,
}));

describe("All Runs default selection (Issue #1771)", () => {
  let SimulationsPage: React.ComponentType;

  // The page drags the whole suites graph behind it, and a cold transform of it
  // costs more than a test's own budget. It is imported once for the file.
  beforeAll(async () => {
    SimulationsPage = (await import("../simulations-page.tsx")).default;
  }, 60_000);

  beforeEach(() => {
    mockRouterQuery = { project: "my-project" };
    mockPush.mockClear();
    mockReplace.mockClear();
  });

  afterEach(() => {
    cleanup();
    capturedArchiveOnSuccess = undefined;
    vi.restoreAllMocks();
  });

  describe("when the page loads with no suite param in URL", () => {
    /** @scenario "All Runs is selected when page loads" */
    it("selects 'All Runs' as the default sidebar item and displays the All Runs panel", async () => {
      mockRouterQuery = { project: "my-project" };

      renderWithDesignSystem(<SimulationsPage />);

      expect(screen.getByTestId("all-runs-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("suite-detail-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("suite-empty-state")).not.toBeInTheDocument();
    });
  });

  describe("when the user archives the selected suite", () => {
    /** @scenario "All Runs is selected after deleting the current suite" */
    it("navigates to all-runs after archiving", async () => {
      // Start with a suite selected in the URL (catch-all path)
      mockRouterQuery = {
        project: "my-project",
        path: ["run-plans", "my-suite"],
      };

      renderWithDesignSystem(<SimulationsPage />);

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
      expect(mockPush).toHaveBeenCalledWith("/my-project/simulations");
    });
  });
});
