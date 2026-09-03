/**
 * @vitest-environment jsdom
 *
 * The wide run detail drawer: the judge results beside the conversation when
 * the window allows, stacked under it when it does not, and the version the
 * run used in the header. The classic drawer stays as it is.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 * @see specs/features/agent-testing/case-version-history.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
import { ScenarioRunDetailDrawer } from "../scenario-run-detail-drawer";
import { SCENARIO_RUN_STATUS_CONFIG } from "@langwatch/suite-web";
import { ScenarioRunStatus, Verdict } from "@langwatch/scenario-contract";
import { AgentTestingRunDrawer } from "../../agent-testing/drawers/agent-testing-run-drawer";

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

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getRunState: { invalidate: mockInvalidateRunState },
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        getByIdIncludingArchived: { invalidate: vi.fn() },
        listVersions: { invalidate: vi.fn() },
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
    suites: {
      // Every run of the v2 dialog is queued under a plan name.
      runPlan: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      testSuites: { getAll: { useQuery: emptyQuery } },
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    storedObjects: { headById: { useQuery: () => ({ data: undefined }) } },
  },
}));

vi.mock("../../scenarios/scenario-form-drawer", () => ({
  ScenarioFormDrawer: ({ open }: { open?: boolean }) =>
    open ? <div>Edit Scenario</div> : null,
}));

vi.mock("../../scenarios/run-scenario-modal", () => ({
  RunScenarioModal: () => null,
}));

vi.mock("../../../../behavior/use-simulation-update-listener", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));

vi.mock("../../../../behavior/use-simulation-streaming-state", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
    handleStreamingEvent: vi.fn(),
    clearCompleted: vi.fn(),
  }),
}));

vi.mock("@langwatch/workflow-web/hooks/useDejaViewLink", () => ({
  useDejaViewLink: () => ({ href: null }),
}));

vi.mock("../../../../behavior/use-drawer-run-callbacks", () => ({
  useDrawerRunCallbacks: () => ({
    onRunComplete: vi.fn(),
    onRunFailed: vi.fn(),
  }),
}));

vi.mock("../../use-run-scenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));

vi.mock("../../use-scenario-target", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
  readScenarioTarget: () => null,
  writeScenarioTarget: vi.fn(),
}));

vi.mock("../../../../behavior/use-can", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("@langwatch/ui-drawer", () => ({
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

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

vi.mock("../../../../behavior/next-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: "/test-project/agent-testing",
    push: vi.fn(),
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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

function setRunState(
  state: Record<string, unknown> | undefined,
  error?: unknown,
) {
  mockGetRunState.mockReturnValue({ data: state, error: error ?? null });
}

/**
 * The CSS variable Chakra emits for a colour token, so a test can state the
 * colour it wants by the token the code holds rather than by a literal.
 */
function cssVarOfToken(token: string) {
  return `var(--chakra-colors-${token.replace(".", "-")})`;
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function renderWide() {
  return render(<AgentTestingRunDrawer open />, { wrapper: Wrapper });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the wide run detail drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.value = {
      variant: "agent-testing",
      scenarioRunId: "run_1",
      batchRunId: "batch_1",
      scenarioSetId: "__internal__suite_refunds__suite",
    };
    setRunState(makeRunState());
    mockGetScenario.mockReturnValue({
      data: {
        id: "case_1",
        name: "Angry refund request",
        version: 6,
        archivedAt: null,
      },
      isLoading: false,
    });
    mockGetBatchRunData.mockReturnValue({ data: undefined });
    setWindowWidth(1400);
  });

  afterEach(cleanup);

  // --- The wide layout ---

  /** @scenario "On a wide screen the results sit beside the conversation" */
  it("puts the conversation on the left and the results beside it on a wide screen", () => {
    renderWide();

    const grid = screen.getByTestId("wide-drawer-side-by-side");
    const conversation = within(grid).getByTestId("wide-drawer-conversation");
    const results = within(grid).getByTestId("wide-drawer-results");
    // Left column first, results beside it at the same height.
    expect(grid.firstElementChild).toBe(conversation);
    expect(conversation.nextElementSibling).toBe(results);
    expect(
      within(conversation).getByText("I want my money back"),
    ).toBeInTheDocument();
    expect(
      within(results).getByTestId("run-verdict-status-line"),
    ).toBeInTheDocument();
  });

  /** @scenario "On a narrow screen the results stay under the conversation" */
  it("stacks the results under the conversation on a narrow screen", () => {
    setWindowWidth(900);
    renderWide();

    const stacked = screen.getByTestId("wide-drawer-stacked");
    expect(
      screen.queryByTestId("wide-drawer-side-by-side"),
    ).not.toBeInTheDocument();
    const text = stacked.textContent ?? "";
    expect(text.indexOf("I want my money back")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("I want my money back")).toBeLessThan(
      text.indexOf("Verdict:"),
    );
  });

  /** @scenario "The messages carry no heading and no line beside the results" */
  it("draws no conversation heading and no line between the two columns", () => {
    renderWide();

    const conversation = screen.getByTestId("wide-drawer-conversation");
    expect(within(conversation).queryByText("Conversation")).toBeNull();
    // The columns meet with nothing drawn between them.
    expect(conversation).not.toHaveStyle({ borderRightWidth: "1px" });
  });

  /** @scenario "Making the window narrower moves the results back under the conversation" */
  it("moves the results under the conversation when the window narrows", () => {
    renderWide();
    expect(screen.getByTestId("wide-drawer-side-by-side")).toBeInTheDocument();

    act(() => {
      setWindowWidth(900);
      window.dispatchEvent(new Event("resize"));
    });

    const stacked = screen.getByTestId("wide-drawer-stacked");
    expect(
      within(stacked).getByText("I want my money back"),
    ).toBeInTheDocument();
    expect(
      within(stacked).getByTestId("run-verdict-status-line"),
    ).toBeInTheDocument();
  });

  /** @scenario "Both parts scroll on their own in the side-by-side layout" */
  it("gives each side its own scroll container", () => {
    renderWide();

    const conversation = screen.getByTestId("wide-drawer-conversation");
    const results = screen.getByTestId("wide-drawer-results");
    expect(conversation.style.overflowY).toBe("auto");
    expect(results.style.overflowY).toBe("auto");
    // Separate siblings: scrolling one container cannot move the other.
    expect(conversation.contains(results)).toBe(false);
    expect(results.contains(conversation)).toBe(false);
  });

  // --- Content ---

  /** @scenario "The drawer shows the same content in both layouts" */
  it("shows the same conversation, verdicts, duration and cost in both layouts", () => {
    renderWide();

    const assertContent = () => {
      expect(screen.getByText("I want my money back")).toBeInTheDocument();
      expect(screen.getAllByText(/criteria/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText("6.3s").length).toBeGreaterThan(0);
      expect(screen.getAllByText("$0.004200").length).toBeGreaterThan(0);
    };
    assertContent();

    act(() => {
      setWindowWidth(900);
      window.dispatchEvent(new Event("resize"));
    });
    assertContent();
  });

  /** @scenario "The drawer header opens the scenario editor from one labelled button" */
  /** @scenario "The drawer header offers Edit Scenario for the scenario that ran" */
  /** @scenario "The drawer offers Edit Scenario for that scenario" */
  it("offers one Edit Scenario button that opens the scenario editor", async () => {
    const user = userEvent.setup();
    renderWide();

    expect(
      screen.queryByRole("button", { name: "Run again" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit scenario" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Scenario" }));

    expect(mockOpenDrawer).toHaveBeenCalledWith("agentTestingCaseEditor", {
      scenarioId: "case_1",
    });
  });

  /** @scenario "A run that is still going shows the conversation growing beside empty results" */
  it("grows the conversation on the left while the conversation is running", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.IN_PROGRESS,
        results: null,
        messages: [{ id: "m1", role: "user", content: "I want my money back" }],
      }),
    );
    const view = renderWide();

    expect(screen.getByTestId("run-verdict-pending")).toHaveTextContent(
      "Waiting for more turns to define a verdict",
    );
    expect(screen.getByTestId("run-verdict-pending")).not.toContainElement(
      screen.queryByRole("progressbar"),
    );
    expect(screen.getByText("I want my money back")).toBeInTheDocument();
    // The user has spoken, so the agent is the one being waited for.
    expect(screen.getByTestId("conversation-typing")).toHaveAttribute(
      "data-typing-role",
      "assistant",
    );

    setRunState(
      makeRunState({
        status: ScenarioRunStatus.IN_PROGRESS,
        results: null,
        messages: [
          { id: "m1", role: "user", content: "I want my money back" },
          { id: "m2", role: "assistant", content: "Let me check the order" },
        ],
      }),
    );
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <AgentTestingRunDrawer open />
      </ChakraProvider>,
    );

    expect(screen.getByText("Let me check the order")).toBeInTheDocument();
    expect(screen.getByTestId("run-verdict-pending")).toBeInTheDocument();
    // The judge reads the agent's answer next, and it writes no message, so
    // nothing is drawn for it.
    expect(screen.queryByTestId("conversation-typing")).not.toBeInTheDocument();
  });

  /** @scenario "A run that is still going shows the conversation growing beside empty results" */
  it("reads no score at all on a run whose stored results are empty", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.IN_PROGRESS,
        // The live stream leaves an empty result object behind; the judge has
        // still said nothing, so the drawer must not read it as 0 of 0.
        results: { verdict: null, metCriteria: [], unmetCriteria: [] },
      }),
    );
    renderWide();

    expect(screen.getByTestId("run-verdict-pending")).toBeInTheDocument();
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
  });

  /** @scenario "A finished conversation with no verdict yet says the judge is reading it" */
  it("reads that the judge is reading the conversation until the verdict lands", () => {
    setRunState(
      makeRunState({
        // The terminal status is stamped before the verdict is written.
        status: ScenarioRunStatus.SUCCESS,
        results: { verdict: null, metCriteria: [], unmetCriteria: [] },
      }),
    );
    const view = renderWide();

    expect(screen.getByTestId("run-verdict-pending")).toHaveTextContent(
      "The judge is reading the conversation",
    );

    setRunState(
      makeRunState({
        status: ScenarioRunStatus.SUCCESS,
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: ["stays polite"],
          unmetCriteria: [],
        },
      }),
    );
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <AgentTestingRunDrawer open />
      </ChakraProvider>,
    );

    expect(screen.queryByTestId("run-verdict-pending")).not.toBeInTheDocument();
    expect(screen.getAllByText(/stays polite/).length).toBeGreaterThan(0);
  });

  /** @scenario "A verdict with no criteria reads the judge's reasoning" */
  it("reads the reasoning of a scripted verdict that has no criteria", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.SUCCESS,
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: [],
          unmetCriteria: [],
          reasoning: "The agent answered",
        },
      }),
    );
    renderWide();

    expect(screen.queryByTestId("run-verdict-pending")).not.toBeInTheDocument();
    expect(screen.getByText("The agent answered")).toBeInTheDocument();
  });

  // --- A run that failed before it reached a verdict ---

  /**
   * The shape the scenario runner stores when a run fails: its own error, its
   * message and its stack, as one JSON string in the run's error field.
   */
  const RUNNER_FAILURE_STACK = [
    "Error: [UserSimulatorAgent] Error: No response content from LLM",
    "    at ScenarioExecution.callAgent (/app/node_modules/@langwatch/scenario/dist/index.js:12358:13)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
  ].join("\n");

  const RUNNER_FAILURE = JSON.stringify({
    name: "Error",
    message: "[UserSimulatorAgent] Error: No response content from LLM",
    stack: RUNNER_FAILURE_STACK,
  });

  function setFailedRunState() {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.ERROR,
        results: {
          verdict: Verdict.FAILURE,
          metCriteria: [],
          unmetCriteria: [],
          reasoning:
            "Scenario failed with error: [UserSimulatorAgent] Error: No response content from LLM",
          error: RUNNER_FAILURE,
        },
      }),
    );
  }

  /** @scenario "A failed run reads a named failure instead of a stack" */
  it("names the failure and holds the stack back", () => {
    setFailedRunState();
    renderWide();

    expect(screen.getByTestId("run-verdict-error")).toHaveTextContent(
      "Model answered with no text",
    );
    expect(screen.getByTestId("run-verdict-error-message")).toHaveTextContent(
      /plays the simulated user/,
    );
    expect(screen.getByTestId("run-verdict-error-hint")).toBeInTheDocument();
    expect(
      screen.queryByTestId("run-verdict-error-detail"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/ScenarioExecution\.callAgent/)).toBeNull();
  });

  /** @scenario "A failed run does not read its own failure twice" */
  it("does not read the failure twice when the reasoning restates it", () => {
    setFailedRunState();
    renderWide();

    expect(screen.queryByTestId("run-verdict-reasoning")).toBeNull();
  });

  /** @scenario "The detail of a failure is one click away" */
  it("reads the stack in a monospace block once More info is clicked", async () => {
    const user = userEvent.setup();
    setFailedRunState();
    renderWide();

    await user.click(screen.getByTestId("run-verdict-error-toggle"));

    const detail = screen.getByTestId("run-verdict-error-detail");
    expect(detail).toHaveTextContent(/ScenarioExecution\.callAgent/);
    // The line breaks the runner recorded are kept rather than collapsed.
    expect(detail.textContent).toContain("\n");
    expect(detail).toHaveStyle({ overflow: "auto" });
    expect(screen.getByTestId("run-verdict-error-toggle")).toHaveTextContent(
      "Hide details",
    );
  });

  /** @scenario "A run that failed before anyone spoke says so" */
  it("says the simulation failed rather than waiting, on a run with no messages", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.ERROR,
        messages: [],
        results: {
          verdict: Verdict.FAILURE,
          metCriteria: [],
          unmetCriteria: [],
          error: RUNNER_FAILURE,
        },
      }),
    );
    renderWide();

    expect(screen.getByTestId("scenario-run-failed-empty")).toHaveTextContent(
      "Simulation failed",
    );
    expect(screen.queryByText("Waiting for the first message")).toBeNull();
  });

  /** @scenario "A queued run reads the whole drawer with a spinner" */
  it("reads a spinner beside the queued line, in the whole layout", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.QUEUED,
        messages: [],
        results: { verdict: null, metCriteria: [], unmetCriteria: [] },
      }),
    );
    renderWide();

    const queued = screen.getByTestId("wide-drawer-queued");
    expect(queued).toHaveTextContent("Queued");
    expect(
      queued.parentElement?.querySelector(".chakra-spinner"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wide-drawer-side-by-side")).toBeInTheDocument();
    expect(screen.getByTestId("run-verdict-pending")).toHaveTextContent(
      "Waiting for the run to start",
    );
  });

  /** @scenario "A queued run reads the whole drawer with a spinner" */
  it("draws the stand-in once the read answers that no run exists yet", () => {
    // The record is written after the job goes out, so the first read of a
    // queued run answers NOT_FOUND. That is the ordinary case rather than a
    // failure, and the drawer must still draw the queued run.
    setRunState(undefined, { data: { code: "NOT_FOUND" } });
    renderWide();

    expect(screen.getByTestId("wide-drawer-queued")).toHaveTextContent(
      "Queued",
    );
    expect(screen.getByTestId("wide-drawer-side-by-side")).toBeInTheDocument();
    expect(screen.getByTestId("run-verdict-pending")).toHaveTextContent(
      "Waiting for the run to start",
    );
  });

  /** @scenario "The criteria appear the moment the run settles" */
  it("reads the stored run again when the run settles without criteria", () => {
    vi.useFakeTimers();
    try {
      setRunState(
        makeRunState({
          // The event stamped the terminal status before the results landed.
          status: ScenarioRunStatus.SUCCESS,
          results: { verdict: null, metCriteria: [], unmetCriteria: [] },
        }),
      );
      renderWide();

      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(mockInvalidateRunState).toHaveBeenCalledWith({
        scenarioRunId: "run_1",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  /** @scenario "The criteria appear the moment the run settles" */
  it("stops reading again once a scripted run answers with a verdict", () => {
    vi.useFakeTimers();
    try {
      // A scripted run, such as the ping an agent test sends, is judged by
      // its script and answers with a verdict and a reasoning and no criteria
      // at all. Its results are there, so there is nothing to wait for.
      setRunState(
        makeRunState({
          status: ScenarioRunStatus.SUCCESS,
          results: {
            verdict: Verdict.SUCCESS,
            reasoning: "The agent answered the ping.",
            metCriteria: [],
            unmetCriteria: [],
          },
        }),
      );
      renderWide();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(mockInvalidateRunState).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- The results panel ---

  /** @scenario "The results split the criteria into passed and failed sections" */
  it("splits the criteria into a passed section over a failed section", () => {
    mockGetScenario.mockReturnValue({
      data: {
        id: "case_1",
        name: "Angry refund request",
        version: 6,
        archivedAt: null,
        criteria: [
          "stays polite",
          "names the refund window",
          "offers the refund",
        ],
      },
      isLoading: false,
    });
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.FAILED,
        results: {
          verdict: Verdict.FAILURE,
          metCriteria: ["stays polite", "offers the refund"],
          unmetCriteria: ["names the refund window"],
        },
      }),
    );
    renderWide();

    const panel = screen.getByTestId("run-verdict-panel");
    const passed = within(panel).getByTestId("run-verdict-passed-criteria");
    const failed = within(panel).getByTestId("run-verdict-failed-criteria");
    expect(within(passed).getByText("Passed criteria")).toBeInTheDocument();
    expect(within(failed).getByText("Failed criteria")).toBeInTheDocument();
    // The two rows in the passed section keep the order the scenario declares.
    const passedText = passed.textContent ?? "";
    expect(passedText.indexOf("stays polite")).toBeLessThan(
      passedText.indexOf("offers the refund"),
    );
    // The failed section holds only its own criteria.
    expect(
      within(failed).getByText("names the refund window"),
    ).toBeInTheDocument();
    expect(within(failed).queryByText("stays polite")).not.toBeInTheDocument();
    // Failed sits above passed: it is what the reader opened the run for.
    const text = panel.textContent ?? "";
    expect(text.indexOf("Failed criteria")).toBeLessThan(
      text.indexOf("Passed criteria"),
    );
    // Icons match: two green checks, one red cross.
    expect(panel.querySelectorAll("svg.lucide-circle-check")).toHaveLength(2);
    expect(panel.querySelectorAll("svg.lucide-circle-x")).toHaveLength(1);
  });

  /** @scenario "A pass run hides the Failed criteria section" */
  it("hides the Failed criteria section on a run that met every criterion", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.SUCCESS,
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: ["stays polite", "offers the refund"],
          unmetCriteria: [],
        },
      }),
    );
    renderWide();

    const panel = screen.getByTestId("run-verdict-panel");
    expect(
      within(panel).getByTestId("run-verdict-passed-criteria"),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByTestId("run-verdict-failed-criteria"),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByText("Failed criteria"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A fail run hides the Passed criteria section" */
  it("hides the Passed criteria section on a run that missed every criterion", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.FAILED,
        results: {
          verdict: Verdict.FAILURE,
          metCriteria: [],
          unmetCriteria: ["stays polite", "offers the refund"],
        },
      }),
    );
    renderWide();

    const panel = screen.getByTestId("run-verdict-panel");
    expect(
      within(panel).getByTestId("run-verdict-failed-criteria"),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByTestId("run-verdict-passed-criteria"),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByText("Passed criteria"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The verdict line reads over the criteria" */
  it("reads a Verdict line over the criteria and repeats nothing from the chip strip", () => {
    renderWide();

    const panel = screen.getByTestId("run-verdict-panel");
    const statusLine = within(panel).getByTestId("run-verdict-status-line");
    expect(within(statusLine).getByText("Verdict:")).toBeInTheDocument();
    expect(
      within(statusLine).getByTestId("run-verdict-status-passed"),
    ).toHaveTextContent("PASSED");
    // The verdict is the answer, so it reads first; the criteria under it
    // are how the judge got there.
    const text = panel.textContent ?? "";
    expect(text.indexOf("Verdict:")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Verdict:")).toBeLessThan(
      text.indexOf("Passed criteria"),
    );
    expect(panel).not.toHaveTextContent(/LLM judge/i);
    expect(panel).not.toHaveTextContent(/success rate/i);
    expect(panel).not.toHaveTextContent("6.3s");
    // The terminal log box is gone.
    expect(screen.queryByText("test-results.log")).not.toBeInTheDocument();
  });

  /** @scenario "The verdict reads the colour every other surface gives the status" */
  it("draws the verdict in the colour the status config holds", () => {
    renderWide();

    const passedColor = cssVarOfToken(
      SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.SUCCESS].fgColor,
    );
    const panel = screen.getByTestId("run-verdict-panel");
    expect(within(panel).getByTestId("run-verdict-status-passed")).toHaveStyle({
      color: passedColor,
    });

    const passedSection = within(panel).getByTestId(
      "run-verdict-passed-criteria",
    );
    expect(
      within(passedSection).getByText("Passed criteria").parentElement,
    ).toHaveStyle({ color: passedColor });
  });

  /** @scenario "A failed run reads FAILED in the verdict line" */
  it("reads FAILED in red at the top of the panel on a failed run", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.FAILED,
        results: {
          verdict: Verdict.FAILURE,
          metCriteria: [],
          unmetCriteria: ["stays polite"],
        },
      }),
    );
    renderWide();

    const panel = screen.getByTestId("run-verdict-panel");
    const failed = within(panel).getByTestId("run-verdict-status-failed");
    expect(failed).toHaveTextContent("FAILED");
  });

  /** @scenario "What the judge said about the run as a whole reads last" */
  it("reads the overall reasoning as a muted paragraph under the criteria", () => {
    setRunState(
      makeRunState({
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: ["stays polite"],
          unmetCriteria: [],
          reasoning:
            "The agent stayed calm and answered the refund question.\nIt named the refund window.",
        },
      }),
    );
    renderWide();

    const panel = screen.getByTestId("run-verdict-panel");
    const reasoning = within(panel).getByTestId("run-verdict-reasoning");
    expect(reasoning).toHaveTextContent(
      "The agent stayed calm and answered the refund question.",
    );
    expect(within(panel).getByText("Judge reasoning")).toBeInTheDocument();
    // The breaks the judge wrote are kept, and the text still wraps.
    expect(window.getComputedStyle(reasoning).whiteSpace).toBe("pre-wrap");
    const text = panel.textContent ?? "";
    expect(text.indexOf("stays polite")).toBeLessThan(
      text.indexOf("The agent stayed calm"),
    );
  });

  // --- The version the run used ---

  /** @scenario "The run detail drawer shows the version the run used" */
  it("reads the version the run recorded, not the version the scenario is at now", () => {
    renderWide();

    // The run recorded v3; the scenario is at v6 now.
    expect(screen.getByTestId("case-version-3")).toBeInTheDocument();
    expect(screen.queryByTestId("case-version-6")).not.toBeInTheDocument();
  });

  /** @scenario "The run drawer offers no History control" */
  /** @scenario "The version in the drawer is a fact of the run, not a control" */
  it("reads the version as a plain chip and offers no History control", async () => {
    const user = userEvent.setup();
    renderWide();

    expect(screen.queryByTestId("run-drawer-history")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("run-drawer-version"));

    // The history belongs to the scenario, so the chip is a fact of the run and
    // opens nothing.
    expect(mockOpenDrawer).not.toHaveBeenCalledWith(
      "scenarioVersionHistory",
      expect.anything(),
    );
  });

  /** @scenario "A run made before versions were recorded shows no version" */
  it("shows no version on a run recorded before versions existed", () => {
    setRunState(
      makeRunState({
        metadata: {
          langwatch: { targetReferenceId: "agent_1", targetType: "http" },
        },
      }),
    );
    renderWide();

    expect(screen.queryByTestId("run-drawer-version")).not.toBeInTheDocument();
    // Nothing else changes: the run still reads as it always did.
    expect(screen.getByText("I want my money back")).toBeInTheDocument();
    expect(screen.getAllByText("6.3s").length).toBeGreaterThan(0);
  });
});

describe("the classic run detail drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.value = { scenarioRunId: "run_1" };
    setRunState(makeRunState());
    mockGetScenario.mockReturnValue({
      data: {
        id: "case_1",
        name: "Angry refund request",
        version: 6,
        archivedAt: null,
      },
      isLoading: false,
    });
    mockGetBatchRunData.mockReturnValue({ data: undefined });
    setWindowWidth(1400);
  });

  afterEach(cleanup);

  /** @scenario "The v1 drawer keeps its width and its stacked results" */
  it("renders the classic layout when no variant is asked for", () => {
    render(<ScenarioRunDetailDrawer open />, { wrapper: Wrapper });

    // None of the wide furniture: no wide shell, no side-by-side grid, no
    // version chip, no History control.
    expect(
      screen.queryByTestId("agent-testing-run-drawer"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("wide-drawer-side-by-side"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("run-drawer-history")).not.toBeInTheDocument();

    // The results read under the conversation, in their accordion section.
    const body = screen.getByText("Conversation").closest("body")!;
    const text = body.textContent ?? "";
    expect(text.indexOf("Conversation")).toBeLessThan(text.indexOf("Results"));
  });
});
