/**
 * @vitest-environment jsdom
 *
 * Integration test for issue #3363: Quick Run no-navigation invariant.
 *
 * Pins that SimulationsPage's useRunSuite({ onRunScheduled }) callback does
 * NOT navigate after a run is scheduled — the user stays wherever they were
 * (All Runs, a different suite's detail, or the same suite's detail).
 *
 * @see specs/features/suites/quick-run-stay-in-place.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any import that touches the module
// ---------------------------------------------------------------------------

const mockRouterPush = vi.hoisted(() => vi.fn());
const mockRouterReplace = vi.hoisted(() => vi.fn());

/**
 * Capture the onRunScheduled callback passed by SimulationsPage to useRunSuite
 * so individual tests can trigger it directly without simulating a full
 * API mutation cycle.
 */
const capturedOnRunScheduled = vi.hoisted(
  () =>
    ({
      current: null,
    }) as { current: ((suiteId: string, batchRunId: string) => void) | null },
);

/**
 * Capture the flow callbacks registered by SimulationsPage via setFlowCallbacks("suiteEditor", …)
 * so AC6 tests can directly invoke onRunRequested and assert navigation fires.
 */
const capturedFlowCallbacks = vi.hoisted(() => ({
  current: null as {
    onRunRequested?: (suite: any) => void;
    onSaved?: (suite: any) => void;
  } | null,
}));

// Router mock — path is overridden per describe block via routerQueryPath
const routerQueryPath = vi.hoisted(() => ({ current: undefined as string[] | undefined }));

/**
 * Hoisted spy on the suites.getSummaries cache invalidator. Pins AC4:
 * onRunScheduled must keep firing the invalidation so the sidebar row
 * refreshes after a quick run.
 */
const mockGetSummariesInvalidate = vi.hoisted(() => vi.fn());

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
    query: {
      project: "test-project",
      ...(routerQueryPath.current !== undefined ? { path: routerQueryPath.current } : {}),
    },
    pathname: "/[project]/simulations/[[...path]]",
    asPath: routerQueryPath.current?.length
      ? `/test-project/simulations/${routerQueryPath.current.join("/")}`
      : "/test-project/simulations",
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

// Capture onRunScheduled from useRunSuite — do NOT mock useSuiteRouting so
// navigateToSuite runs for real and calls router.push (that is what we observe).
vi.mock("~/components/suites/useRunSuite", () => ({
  useRunSuite: (opts: {
    onRunScheduled?: (suiteId: string, batchRunId: string) => void;
  }) => {
    capturedOnRunScheduled.current = opts.onRunScheduled ?? null;
    return {
      requestRun: vi.fn(),
      confirmRun: vi.fn(),
      cancelRun: vi.fn(),
      isPending: false,
      pendingBatchRunId: null,
      dialogProps: {
        open: false,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        suiteName: "",
        scenarioCount: 0,
        targetCount: 0,
        repeatCount: 1,
        isLoading: false,
      },
    };
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "test-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    setFlowCallbacks: (_flow: string, callbacks: any) => {
      capturedFlowCallbacks.current = callbacks;
    },
  }),
}));

vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => undefined,
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

vi.mock("~/components/suites/RunHistoryPanel", () => ({
  RunHistoryPanel: () => <div data-testid="all-runs-panel">All Runs Panel</div>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      suites: {
        getAll: { invalidate: vi.fn() },
        getSummaries: { invalidate: mockGetSummariesInvalidate },
      },
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getExternalSetSummaries: { invalidate: vi.fn() },
      },
    }),
    suites: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "suite_target",
              projectId: "project_1",
              name: "Target Suite",
              slug: "target-suite-slug",
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
      getSummaries: {
        useQuery: () => ({ data: {}, isLoading: false }),
      },
      archive: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
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
    agents: {
      getAll: {
        useQuery: () => ({ data: [] }),
      },
    },
    prompts: {
      getAllPromptsForProject: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

async function renderSimulationsPage() {
  // Dynamic import ensures mocks are applied before the module is evaluated
  const { default: SimulationsPage } = await import(
    "~/components/suites/SimulationsPage"
  );
  render(<SimulationsPage />, { wrapper: Wrapper });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SimulationsPage quick-run no-navigation invariant (#3363)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    capturedOnRunScheduled.current = null;
    capturedFlowCallbacks.current = null;
    routerQueryPath.current = undefined;
  });

  describe("given a suite with id 'suite_target' and slug 'target-suite-slug'", () => {
    describe("when the user is on All Runs", () => {
      it("does not call the router push API when a run is scheduled", async () => {
        // All Runs: no path segments
        routerQueryPath.current = undefined;

        await renderSimulationsPage();

        expect(capturedOnRunScheduled.current).not.toBeNull();

        // Simulate a run being scheduled for the target suite
        capturedOnRunScheduled.current!("suite_target", "batch_001");

        expect(mockRouterPush).not.toHaveBeenCalled();
      });

      it("still invalidates the suites.getSummaries cache so the sidebar row refreshes", async () => {
        routerQueryPath.current = undefined;

        await renderSimulationsPage();

        expect(capturedOnRunScheduled.current).not.toBeNull();

        capturedOnRunScheduled.current!("suite_target", "batch_004");

        expect(mockGetSummariesInvalidate).toHaveBeenCalled();
      });
    });

    describe("when the user is on a different suite's detail page", () => {
      it("does not call the router push API when a run is scheduled", async () => {
        // Different suite detail page
        routerQueryPath.current = ["run-plans", "other-suite-slug"];

        await renderSimulationsPage();

        expect(capturedOnRunScheduled.current).not.toBeNull();

        capturedOnRunScheduled.current!("suite_target", "batch_002");

        expect(mockRouterPush).not.toHaveBeenCalled();
        expect(mockGetSummariesInvalidate).toHaveBeenCalled();
      });
    });

    describe("when the user is on the same suite's detail page", () => {
      it("does not call the router push API when a run is scheduled", async () => {
        // Same suite detail page
        routerQueryPath.current = ["run-plans", "target-suite-slug"];

        await renderSimulationsPage();

        expect(capturedOnRunScheduled.current).not.toBeNull();

        capturedOnRunScheduled.current!("suite_target", "batch_003");

        expect(mockRouterPush).not.toHaveBeenCalled();
        expect(mockGetSummariesInvalidate).toHaveBeenCalled();
      });
    });
  });

  /**
   * AC6 regression guard — positive invariant.
   *
   * The Save-and-Run flow (handleRunRequested registered via setFlowCallbacks)
   * MUST still navigate to the suite detail page. This is the OPPOSITE of the
   * no-nav invariant above: we are guarding against a future change that
   * accidentally widens the no-nav fix to cover this drawer flow too.
   */
  describe("given the suite editor drawer is open", () => {
    describe("when Save and Run fires for a saved suite (AC6 regression guard)", () => {
      /** @scenario Save and Run from the suite editor drawer still navigates to the suite detail page */
      it("calls router push toward the suite detail page", async () => {
        const user = userEvent.setup();
        routerQueryPath.current = undefined; // Start on All Runs

        await renderSimulationsPage();

        // Open the suite editor drawer — this causes SimulationsPage to call
        // setFlowCallbacks("suiteEditor", { onSaved, onRunRequested }) which
        // populates capturedFlowCallbacks.current.
        const newSuiteButton = await screen.findByRole("button", {
          name: /New Run Plan/i,
        });
        await user.click(newSuiteButton);

        expect(capturedFlowCallbacks.current).not.toBeNull();
        expect(capturedFlowCallbacks.current!.onRunRequested).toBeDefined();

        // Simulate the Save-and-Run callback firing with a newly saved suite
        const testSuite = {
          id: "suite_saved",
          projectId: "project_1",
          name: "Newly Saved Suite",
          slug: "newly-saved-slug",
          description: null,
          scenarioIds: [],
          targets: [],
          repeatCount: 1,
          labels: [],
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        capturedFlowCallbacks.current!.onRunRequested!(testSuite);

        // navigateToSuite must fire — router.push called with the run-plans path
        expect(mockRouterPush).toHaveBeenCalled();
        const pushCall = mockRouterPush.mock.calls[0]!;
        const [routeArg] = pushCall;
        expect(routeArg).toMatchObject({
          query: expect.objectContaining({
            path: expect.arrayContaining(["run-plans", "newly-saved-slug"]),
          }),
        });
      });
    });
  });
});
