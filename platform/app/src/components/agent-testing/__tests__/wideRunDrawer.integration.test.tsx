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
import { ScenarioRunDetailDrawer } from "~/components/simulations/ScenarioRunDetailDrawer";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { AgentTestingRunDrawer } from "../drawers/AgentTestingRunDrawer";
import { useAgentTestingStore } from "../useAgentTestingStore";

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

vi.mock("~/utils/api", () => ({
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
      suites: { folders: { getAll: { invalidate: vi.fn() } } },
    }),
    scenarios: {
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
      folders: { getAll: { useQuery: emptyQuery } },
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
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

vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));

vi.mock("~/hooks/useSimulationStreamingState", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
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

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));

vi.mock("~/hooks/useScenarioTarget", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
  readScenarioTarget: () => null,
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
    expect(within(results).getByText("Results")).toBeInTheDocument();
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
    expect(text.indexOf("Conversation")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Conversation")).toBeLessThan(text.indexOf("Results"));
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
    expect(within(stacked).getByText("Results")).toBeInTheDocument();
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
      expect(screen.getAllByText(/Criteria/).length).toBeGreaterThan(0);
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

  /** @scenario "The drawer header offers Edit for the test case that ran" */
  /** @scenario "The drawer offers Rerun and Edit for that case" */
  it("offers Rerun and Edit in the header, and Edit opens the case editor", async () => {
    const user = userEvent.setup();
    renderWide();

    expect(
      screen.getByRole("button", { name: "Run again" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit scenario" }));

    expect(useAgentTestingStore.getState().caseEditor).toEqual({
      open: true,
      scenarioId: "case_1",
      folderId: null,
    });
  });

  /** @scenario "A run that is still going shows the conversation growing beside empty results" */
  it("grows the conversation on the left while the judge has not run yet", () => {
    setRunState(
      makeRunState({
        status: ScenarioRunStatus.IN_PROGRESS,
        results: null,
        messages: [{ id: "m1", role: "user", content: "I want my money back" }],
      }),
    );
    const view = renderWide();

    expect(screen.getByTestId("judge-pending")).toHaveTextContent(
      "The judge has not run yet.",
    );
    expect(screen.getByText("I want my money back")).toBeInTheDocument();

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
    expect(screen.getByTestId("judge-pending")).toBeInTheDocument();
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

    expect(screen.getByTestId("judge-pending")).toBeInTheDocument();
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
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

  // --- The version the run used ---

  /** @scenario "The run detail drawer shows the version the run used" */
  it("reads the version the run recorded, not the version the case is at now", () => {
    renderWide();

    // The run recorded v3; the case is at v6 now.
    expect(screen.getByTestId("case-version-3")).toBeInTheDocument();
    expect(screen.queryByTestId("case-version-6")).not.toBeInTheDocument();
  });

  /** @scenario "The version in the drawer opens the history of that case" */
  it("opens the case history on the recorded version from the chip", async () => {
    const user = userEvent.setup();
    renderWide();

    await user.click(screen.getByTestId("run-drawer-version"));

    expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioVersionHistory", {
      urlParams: { scenarioId: "case_1", markVersion: "3" },
    });
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

  /** @scenario "The History control is not shown for a case in an external set" */
  it("offers no History control when the case exists only as external runs", () => {
    mockGetScenario.mockReturnValue({ data: null, isLoading: false });
    setRunState(
      makeRunState({
        metadata: {
          langwatch: { targetReferenceId: "agent_1", targetType: "http" },
        },
      }),
    );
    renderWide();

    expect(screen.queryByTestId("run-drawer-history")).not.toBeInTheDocument();
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
