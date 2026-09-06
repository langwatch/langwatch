/**
 * @vitest-environment jsdom
 *
 * Running one scenario keeps the person in place: the run dialog confirms, the
 * run goes out as an ordinary run plan named after the scenario and the agent,
 * the wide drawer opens at queue time, the conversation streams into it, and
 * the verdict lands in the same drawer.
 *
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { TestCasesTab } from "../cases/TestCasesTab";
import { AgentTestingRunDrawer } from "../drawers/AgentTestingRunDrawer";
import { RunDialog } from "../run/RunDialog";
import { useAgentTestingStore } from "../useAgentTestingStore";

const mockGetRunState = vi.hoisted(() => vi.fn());
const mockGetScenario = vi.hoisted(() => vi.fn());
const mockGetBatchRunData = vi.hoisted(() => vi.fn());
const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockTestSuitesGetAll = vi.hoisted(() => vi.fn());
const mockLastResults = vi.hoisted(() => vi.fn());
const mockRunScenario = vi.hoisted(() => vi.fn());
const mockSuitesRunPlan = vi.hoisted(() => vi.fn());
const mockCancelJob = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockHasProviders = vi.hoisted(() => ({ value: true }));
const mockRouterState = vi.hoisted(() => ({
  asPath: "/test-project/agent-testing",
}));
const mockParams = vi.hoisted(() => ({
  value: {} as Record<string, string | undefined>,
}));
const mockStreaming = vi.hoisted(() => ({ value: [] as StreamingMessage[] }));

const emptyQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
      },
      suites: {
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getAll: { useQuery: mockScenariosGetAll },
      getRunState: { useQuery: mockGetRunState },
      getById: { useQuery: mockGetScenario },
      getByIdIncludingArchived: { useQuery: mockGetScenario },
      getBatchRunData: { useQuery: mockGetBatchRunData },
      getExternalSetSummaries: { useQuery: emptyQuery },
      getLastResultSummaries: { useQuery: mockLastResults },
      getScenarioSetRunData: { useQuery: emptyQuery },
      getSuiteRunData: { useQuery: emptyQuery },
      getScenarioSetBatchRunCount: { useQuery: emptyQuery },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      moveToTestSuite: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      cancelJob: {
        useMutation: () => ({ mutate: mockCancelJob, isPending: false }),
      },
      cancelBatchRun: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    suites: {
      testSuites: {
        getAll: { useQuery: mockTestSuitesGetAll },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        rename: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      getAll: { useQuery: emptyQuery },
      getSummaries: { useQuery: emptyQuery },
      create: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      update: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      run: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      runPlan: {
        useMutation: () => ({
          mutateAsync: mockSuitesRunPlan,
          isPending: false,
        }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: { useQuery: emptyQuery },
    },
    agents: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "agent_1",
              name: "prod-agent",
              type: "http",
              updatedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
            {
              id: "agent_2",
              name: "dev-agent",
              type: "http",
              updatedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
          ],
        }),
      },
    },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    storedObjects: { headById: { useQuery: () => ({ data: undefined }) } },
  },
}));

vi.mock("~/components/scenarios/ScenarioFormDrawer", () => ({
  ScenarioFormDrawer: ({ open }: { open?: boolean }) =>
    open ? <div>Edit Scenario</div> : null,
}));

vi.mock("~/components/scenarios/RunScenarioModal", () => ({
  RunScenarioModal: () => null,
}));

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: mockRunScenario, isRunning: false }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    hasEnabledProviders: mockHasProviders.value,
  }),
}));

vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));

vi.mock("~/hooks/useSimulationStreamingState", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: mockStreaming.value,
    handleStreamingEvent: vi.fn(),
    clearCompleted: vi.fn(),
  }),
}));

vi.mock("~/hooks/useDejaViewLink", () => ({
  useDejaViewLink: () => ({ href: null }),
}));

vi.mock("~/hooks/useDrawerRunCallbacks", () => ({
  useDrawerRunCallbacks: () => ({
    onRunComplete: vi.fn(),
    onRunFailed: vi.fn(),
  }),
}));

vi.mock("~/hooks/useScenarioTarget", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
  readScenarioTarget: () => ({ type: "http", id: "agent_1" }),
  writeScenarioTarget: vi.fn(),
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("~/hooks/useDrawer", () => ({
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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    asPath: mockRouterState.asPath,
    push: mockRouterPush,
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** The run set of the plan a single-scenario run resolves onto. */
const PLAN_SET_ID = "__internal__plan_angry__suite";

const REFUNDS = {
  id: "suite_refunds",
  name: "Refunds",
  slug: "refunds",
  scenarioIds: ["case_1"],
  targets: [],
};

function scenarioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "case_1",
    name: "Angry refund request",
    labels: [],
    testSuiteId: REFUNDS.id,
    parameters: null,
    createdAt: new Date("2026-07-06T12:00:00.000Z"),
    lastUpdatedById: null,
    version: 1,
    ...overrides,
  };
}

function makeRunState(overrides: Record<string, unknown> = {}) {
  return {
    scenarioRunId: "run_1",
    scenarioId: "case_1",
    batchRunId: "batch_1",
    name: "Angry refund request",
    status: ScenarioRunStatus.IN_PROGRESS,
    results: null,
    messages: [{ id: "m1", role: "user", content: "I want my money back" }],
    metadata: {
      langwatch: { targetReferenceId: "agent_1", targetType: "http" },
    },
    timestamp: Date.now(),
    durationInMs: 0,
    totalCost: null,
    ...overrides,
  };
}

async function confirmRowRun(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Run Angry refund request" }),
  );
  const dialog = await screen.findByTestId("run-case-dialog");
  await user.click(within(dialog).getByTestId("run-dialog-run"));
  await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
}

/** The one payload the run dialog sent to the run plan endpoint. */
function queuedPlanRun(call = 0) {
  return mockSuitesRunPlan.mock.calls[call]![0] as {
    name: string;
    config: { scope: { mode: string }; scenarioIds?: string[] };
  };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("starting a run of one scenario from the scenario table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    mockRouterState.asPath = "/test-project/agent-testing";
    useAgentTestingStore.setState({
      lastRunTarget: null,
      pendingRun: null,
    });
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow()],
      isLoading: false,
    });
    mockTestSuitesGetAll.mockReturnValue({ data: [REFUNDS], isLoading: false });
    mockLastResults.mockReturnValue({ data: [], isLoading: false });
    mockGetRunState.mockReturnValue({ data: undefined, error: null });
    mockGetBatchRunData.mockReturnValue({ data: undefined });
    mockGetScenario.mockReturnValue({ data: scenarioRow(), isLoading: false });
    mockRunScenario.mockReturnValue(new Promise(() => undefined));
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_q",
      jobCount: 1,
      suiteId: "plan_angry",
      planName: "Angry refund request prod-agent",
      created: true,
    });
  });

  afterEach(cleanup);

  /** @scenario "Confirming a run from a scenario row does not change the address" */
  it("keeps the address and the table when a run is confirmed", async () => {
    const user = userEvent.setup();
    render(<TestCasesTab />, { wrapper: Wrapper });

    await confirmRowRun(user);

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(screen.getByTestId("agent-testing-cases-table")).toBeInTheDocument();
    expect(mockOpenDrawer).toHaveBeenCalledWith(
      "scenarioRunDetail",
      expect.objectContaining({
        urlParams: expect.objectContaining({ variant: "agent-testing" }),
      }),
    );
  });

  /** @scenario "Confirming a run from inside a test suite keeps that suite selected" */
  it("keeps the suite selected in the rail after a run from inside it", async () => {
    const user = userEvent.setup();
    mockRouterState.asPath = "/test-project/agent-testing/suites/refunds";
    // Filed under Refunds so the row reads inside that suite.
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow({ testSuiteId: REFUNDS.id })],
      isLoading: false,
    });
    render(<TestCasesTab />, { wrapper: Wrapper });

    await confirmRowRun(user);

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(screen.getByTestId("suite-rail-item-Refunds")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  /** @scenario "The run detail drawer opens as soon as the run is queued" */
  /** @scenario "A queued run draws the whole drawer" */
  it("opens the drawer at queue time, naming the scenario and the target", async () => {
    const user = userEvent.setup();
    render(<TestCasesTab />, { wrapper: Wrapper });

    await confirmRowRun(user);

    // The drawer opens on the batch, before the run has an id, and on the run
    // set of the plan the run joined.
    expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
      urlParams: expect.objectContaining({
        variant: "agent-testing",
        scenarioId: "case_1",
        targetId: "agent_1",
        scenarioSetId: PLAN_SET_ID,
        batchRunId: expect.any(String),
      }),
    });
    cleanup();

    // What that drawer reads while the run is queued: the scenario, the target,
    // and the queued state.
    mockParams.value = {
      variant: "agent-testing",
      batchRunId: "batch_q",
      scenarioSetId: PLAN_SET_ID,
      scenarioId: "case_1",
      targetId: "agent_1",
    };
    mockGetBatchRunData.mockReturnValue({ data: { runs: [] } });
    render(<AgentTestingRunDrawer open />, { wrapper: Wrapper });

    // The whole drawer is drawn, not a bare queued line: the queued read sits
    // where the messages will be, and the results column waits beside it.
    expect(screen.getByTestId("wide-drawer-queued")).toHaveTextContent(
      "Queued",
    );
    expect(screen.getByTestId("wide-drawer-side-by-side")).toBeInTheDocument();
    expect(screen.getByTestId("run-verdict-pending")).toHaveTextContent(
      "Waiting for the run to start",
    );
    expect(
      screen.getByText(/prod-agent: Angry refund request/),
    ).toBeInTheDocument();
  });

  /** @scenario "The run goes out under a plan named after the scenario and the agent" */
  it("queues one run plan named after the scenario and the agent, covering that scenario alone", async () => {
    const user = userEvent.setup();
    render(<TestCasesTab />, { wrapper: Wrapper });

    await confirmRowRun(user);

    const sent = queuedPlanRun();
    expect(sent.name).toBe("Angry refund request prod-agent");
    expect(sent.config.scope).toEqual({ mode: "scenarios" });
    expect(sent.config.scenarioIds).toEqual(["case_1"]);
    // Nothing goes to the scenario runner any more, so nothing lands in the
    // project's internal run set.
    expect(mockRunScenario).not.toHaveBeenCalled();
  });

  /** @scenario "Running the same scenario against the same agent again joins the same plan" */
  it("sends the same name both times, so the second run joins the first plan", async () => {
    const user = userEvent.setup();
    const view = render(<TestCasesTab />, { wrapper: Wrapper });

    await confirmRowRun(user);
    // The second run resolves onto the plan the first one created, which is
    // what the server answers when the name matches.
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_q2",
      jobCount: 1,
      suiteId: "plan_angry",
      planName: "Angry refund request prod-agent",
      created: false,
    });
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <TestCasesTab />
      </ChakraProvider>,
    );
    await user.click(
      screen.getByRole("button", { name: "Run Angry refund request" }),
    );
    const dialog = await screen.findByTestId("run-case-dialog");
    await user.click(within(dialog).getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalledTimes(2));

    expect(queuedPlanRun(0).name).toBe("Angry refund request prod-agent");
    expect(queuedPlanRun(1).name).toBe(queuedPlanRun(0).name);
    // Two batches, one plan: the plan's run list is what grows a trend.
    expect(queuedPlanRun(1)).not.toBe(queuedPlanRun(0));
    expect(mockOpenDrawer).toHaveBeenLastCalledWith(
      "scenarioRunDetail",
      expect.objectContaining({
        urlParams: expect.objectContaining({
          scenarioSetId: PLAN_SET_ID,
          batchRunId: "batch_q2",
        }),
      }),
    );
  });

  /** @scenario "Running the same scenario against another agent is another plan" */
  it("names the other agent when the run goes against it", async () => {
    const user = userEvent.setup();
    render(<TestCasesTab />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("button", { name: "Run Angry refund request" }),
    );
    const dialog = await screen.findByTestId("run-case-dialog");
    await user.click(within(dialog).getByTestId("run-dialog-agent-agent_2"));
    expect(within(dialog).getByTestId("run-dialog-name")).toHaveValue(
      "Angry refund request dev-agent",
    );

    await user.click(within(dialog).getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(queuedPlanRun().name).toBe("Angry refund request dev-agent");
  });

  /** @scenario "Closing the drawer leaves the table where it was" */
  it("shows the same table with the fresh verdict once the drawer closes", async () => {
    const user = userEvent.setup();
    const view = render(<TestCasesTab />, {
      wrapper: Wrapper,
    });

    await confirmRowRun(user);

    // The run finished while the drawer was open; the row reads the new
    // verdict the moment the table is visible again.
    mockLastResults.mockReturnValue({
      data: [
        {
          scenarioId: "case_1",
          status: ScenarioRunStatus.SUCCESS,
          metCriteriaCount: 2,
          unmetCriteriaCount: 0,
          lastRunAt: Date.now(),
          batchRunId: "batch_q",
          scenarioSetId: PLAN_SET_ID,
          durationInMs: 6300,
          totalCost: 0.0042,
        },
      ],
      isLoading: false,
    });
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <TestCasesTab />
      </ChakraProvider>,
    );

    expect(screen.getByTestId("agent-testing-cases-table")).toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

describe("the live run of one scenario in the drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreaming.value = [];
    mockParams.value = {
      variant: "agent-testing",
      scenarioRunId: "run_1",
      batchRunId: "batch_1",
      scenarioSetId: PLAN_SET_ID,
      scenarioId: "case_1",
    };
    mockGetRunState.mockReturnValue({ data: makeRunState(), error: null });
    mockGetBatchRunData.mockReturnValue({ data: undefined });
    mockGetScenario.mockReturnValue({ data: scenarioRow(), isLoading: false });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1400,
    });
  });

  afterEach(cleanup);

  const renderDrawer = () =>
    render(<AgentTestingRunDrawer open />, { wrapper: Wrapper });

  /** @scenario "The conversation streams into the drawer while the run goes on" */
  it("shows each message as it arrives, without a reload", () => {
    mockStreaming.value = [
      {
        messageId: "s1",
        role: "assistant",
        content: "Let me look into that refund",
        messageIndex: 1,
        status: "streaming",
      },
    ];
    renderDrawer();

    expect(screen.getByText("I want my money back")).toBeInTheDocument();
    expect(
      screen.getByText("Let me look into that refund"),
    ).toBeInTheDocument();
  });

  /** @scenario "The judge verdict appears after the conversation ends" */
  it("shows the verdict, each criterion, the duration and the cost when the judge finishes", () => {
    const view = renderDrawer();
    expect(screen.getByTestId("run-verdict-pending")).toBeInTheDocument();

    mockGetRunState.mockReturnValue({
      data: makeRunState({
        status: ScenarioRunStatus.SUCCESS,
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: ["stays polite"],
          unmetCriteria: ["offers the refund"],
        },
        durationInMs: 6300,
        totalCost: 0.0042,
      }),
      error: null,
    });
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <AgentTestingRunDrawer open />
      </ChakraProvider>,
    );

    expect(screen.queryByTestId("run-verdict-pending")).not.toBeInTheDocument();
    expect(screen.getAllByText(/stays polite/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/offers the refund/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("6.3s").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.004200").length).toBeGreaterThan(0);
  });

  /** @scenario "A single-scenario run can be stopped from the drawer" */
  it("stops the run from the drawer and reads that it was stopped", async () => {
    const user = userEvent.setup();
    const view = renderDrawer();

    await user.click(screen.getByTestId("run-drawer-stop"));
    expect(mockCancelJob).toHaveBeenCalledWith({
      projectId: "proj_1",
      scenarioSetId: PLAN_SET_ID,
      batchRunId: "batch_1",
      scenarioRunId: "run_1",
      scenarioId: "case_1",
    });

    mockGetRunState.mockReturnValue({
      data: makeRunState({ status: ScenarioRunStatus.CANCELLED }),
      error: null,
    });
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <AgentTestingRunDrawer open />
      </ChakraProvider>,
    );

    expect(screen.getAllByText(/cancelled/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("run-drawer-stop")).not.toBeInTheDocument();
  });

  /** @scenario "A run that cannot start says why in the drawer" */
  it("reads the named failure in the drawer, never an unknown error", () => {
    mockGetRunState.mockReturnValue({
      data: makeRunState({
        status: ScenarioRunStatus.ERROR,
        results: {
          verdict: Verdict.INCONCLUSIVE,
          metCriteria: [],
          unmetCriteria: [],
          error: "Connection refused: the agent endpoint did not answer",
        },
      }),
      error: null,
    });
    renderDrawer();

    expect(
      screen.getByText(/Connection refused: the agent endpoint did not answer/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/unknown error/i)).not.toBeInTheDocument();
  });
});

describe("a run refused before it is queued", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = false;
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow()],
      isLoading: false,
    });
  });

  afterEach(cleanup);

  /** @scenario "A run refused before it is queued keeps the dialog open" */
  it("keeps the dialog open, says what is missing, and opens no drawer", async () => {
    const user = userEvent.setup();
    const onRunStarted = vi.fn();
    render(
      <RunDialog
        subject={{
          kind: "case",
          scenarioId: "case_1",
          name: "Angry refund request",
          initialTarget: { type: "http", id: "agent_1" },
        }}
        onClose={vi.fn()}
        onRunStarted={onRunStarted}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByTestId("run-dialog-run"));

    const notice = await screen.findByTestId("run-dialog-missing-provider");
    expect(notice).toHaveTextContent("No model provider is set up");
    expect(
      within(notice).getByRole("button", {
        name: "Open model provider settings",
      }),
    ).toBeInTheDocument();
    expect(onRunStarted).not.toHaveBeenCalled();
    expect(mockSuitesRunPlan).not.toHaveBeenCalled();
    expect(mockRunScenario).not.toHaveBeenCalled();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
  });
});
