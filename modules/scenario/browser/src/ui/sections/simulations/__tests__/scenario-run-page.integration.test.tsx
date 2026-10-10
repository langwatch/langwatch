/**
 * The standalone run page: the set, batch and run address renders one run on
 * a page of its own, and Run Again stays there showing the new run.
 * @vitest-environment jsdom
 * @see specs/features/suites/suite-bugfixes-1956.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus, Verdict } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import SimulationsRoutePage from "../simulations.screen.tsx";

const mockPush = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockDrawerNavigate = vi.hoisted(() => vi.fn());
const mockAddress = vi.hoisted(() => ({ value: "" }));

const mockGetRunState = vi.hoisted(() => vi.fn());
const mockGetScenario = vi.hoisted(() => vi.fn());
const mockGetBatchRunData = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockCancelJob = vi.hoisted(() => vi.fn());
const mockInvalidateRunState = vi.hoisted(() => vi.fn());
const mockParams = vi.hoisted(() => ({
  value: {} as Record<string, string | undefined>,
}));

const emptyQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
}));

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    useUtils: () => ({
      suites: {
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    suites: {
      // Every run of the v2 dialog is queued under a plan name.
      runPlan: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      testSuites: { getAll: { useQuery: emptyQuery } },
    },
    agents: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "agent_1", name: "target-A", type: "http" }],
        }),
      },
    },
    storedObjects: { headById: { useQuery: () => ({ data: undefined }) } },
  },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({
      suites: {
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({
      scenarios: {
        getRunState: { invalidate: mockInvalidateRunState },
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        getByIdIncludingArchived: { invalidate: vi.fn() },
        listVersions: { invalidate: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
      },
    }),
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getRunState: { useQuery: mockGetRunState },
      getById: { useQuery: mockGetScenario },
      getByIdIncludingArchived: { useQuery: mockGetScenario },
      getBatchRunData: { useQuery: mockGetBatchRunData },
      getAll: { useQuery: emptyQuery },
      cancelJob: {
        useMutation: () => ({ mutate: mockCancelJob, isPending: false }),
      },
      cancelBatchRun: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("../../scenarios/scenario-form-drawer.tsx", () => ({
  ScenarioFormDrawer: ({ open }: { open?: boolean }) => (open ? <div>Edit Scenario</div> : null),
}));

vi.mock("../../scenarios/run-scenario-modal.tsx", () => ({
  RunScenarioModal: () => null,
}));

vi.mock("../../../../behavior/use-simulation-update-listener.ts", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));

vi.mock("../../../../behavior/use-simulation-streaming-state.ts", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
    handleStreamingEvent: vi.fn(),
    clearCompleted: vi.fn(),
  }),
}));

vi.mock("../../../../behavior/use-deja-view-link.ts", () => ({
  useDejaViewLink: () => ({ href: null }),
}));

vi.mock("../../../../behavior/use-drawer-run-callbacks.ts", () => ({
  useDrawerRunCallbacks: () => ({
    onRunComplete: mockDrawerNavigate,
    onRunFailed: mockDrawerNavigate,
  }),
}));

// Starting a run settles straight away as run_2 in batch_2.
vi.mock("../../use-run-scenario.ts", () => ({
  useRunScenario: (options: {
    onRunComplete?: (result: { scenarioRunId: string; setId: string; batchRunId: string }) => void;
  }) => ({
    runScenario: async () =>
      options.onRunComplete?.({ scenarioRunId: "run_2", setId: "set_1", batchRunId: "batch_2" }),
    isRunning: false,
  }),
}));

vi.mock("../../use-scenario-target.ts", () => ({
  useScenarioTarget: () => ({
    target: { type: "http", id: "agent_1" },
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: true,
  }),
  readScenarioTarget: () => null,
  writeScenarioTarget: vi.fn(),
}));

vi.mock("../../../../behavior/use-can.ts", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
    drawerOpen: () => false,
    setFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => mockParams.value,
  getComplexProps: () => null,
  setFlowCallbacks: vi.fn(),
  clearFlowCallbacks: vi.fn(),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    params: { "*": mockAddress.value },
    search: {},
    asPath: `/test-project/simulations/${mockAddress.value}`,
    push: mockPush,
    replace: mockReplace,
    isReady: true,
  }),
}));

vi.mock("../../../../behavior/suites/use-agent-testing-redirect.ts", () => ({
  useAgentTestingRedirect: () => ({ deciding: false }),
}));

vi.mock("../../suites/simulations-page.tsx", () => ({
  default: () => <div>Simulations list</div>,
}));

function makeRunState(overrides: Record<string, unknown> = {}) {
  return {
    scenarioRunId: "run_1",
    scenarioId: "case_1",
    batchRunId: "batch_1",
    name: "Angry refund request",
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      metCriteria: ["stays polite", "offers the refund"],
      unmetCriteria: [],
    },
    messages: [
      { id: "m1", role: "user", content: "I want my money back" },
      { id: "m2", role: "assistant", content: "Let me help with that refund" },
    ],
    metadata: {
      langwatch: {
        targetReferenceId: "agent_1",
        targetType: "http",
        scenarioVersion: 3,
      },
    },
    timestamp: Date.now(),
    durationInMs: 6300,
    totalCost: 0.0042,
    ...overrides,
  };
}

const RUN_NAMES: Record<string, string> = { run_1: "First run", run_2: "Second run" };

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the standalone run page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddress.value = "set_1/batch_1/run_1";
    mockGetRunState.mockImplementation((input: { scenarioRunId: string }) => ({
      data: makeRunState({
        scenarioRunId: input.scenarioRunId,
        name: RUN_NAMES[input.scenarioRunId],
      }),
      error: null,
    }));
    mockGetScenario.mockReturnValue({
      data: { id: "case_1", name: "Echo user request", version: 1, archivedAt: null },
      isLoading: false,
    });
    mockGetBatchRunData.mockReturnValue({ data: undefined });
  });

  afterEach(cleanup);

  describe("given the set, batch and run address", () => {
    it("renders the run on a page of its own instead of redirecting", () => {
      renderWithDesignSystem(<SimulationsRoutePage />);

      expect(screen.getByTestId("scenario-run-page")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /First run/ })).toBeInTheDocument();
      expect(screen.queryByText("Simulations list")).not.toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    describe("when I click Run Again and the run completes", () => {
      /** @scenario "Run Again from the standalone run page stays on that page" */
      it("stays on the standalone run page and shows the new run", async () => {
        const user = userEvent.setup();
        const { rerender } = renderWithDesignSystem(<SimulationsRoutePage />);

        await user.click(screen.getByRole("button", { name: "Run again" }));

        expect(mockPush).toHaveBeenCalledWith("/test-project/simulations/set_1/batch_2/run_2");
        expect(mockDrawerNavigate).not.toHaveBeenCalled();

        mockAddress.value = "set_1/batch_2/run_2";
        rerender(<SimulationsRoutePage />);

        expect(screen.getByTestId("scenario-run-page")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /Second run/ })).toBeInTheDocument();
      });
    });
  });
});
