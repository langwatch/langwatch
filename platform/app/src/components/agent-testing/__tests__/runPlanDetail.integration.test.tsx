/**
 * @vitest-environment jsdom
 *
 * One run plan: the runs in the rail, and the results of the selected run as
 * a table or as the classic grid.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 * @see specs/suites/one-off-runs-surface.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { RunPlanDetail } from "../results/RunPlanDetail";
import type { RunPlan } from "../results/run-plans";
import { useAgentTestingStore } from "../useAgentTestingStore";

const mockGetSuiteRunData = vi.hoisted(() => vi.fn());
const mockGetBatchRunCount = vi.hoisted(() => vi.fn());
const mockFreshnessQuery = vi.hoisted(() => vi.fn());
const mockCancelJob = vi.hoisted(() => vi.fn());
const mockCancelBatchRun = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn() },
      },
    }),
    scenarios: {
      getSuiteRunData: { useQuery: mockGetSuiteRunData },
      getSuiteRunFreshness: { useQuery: mockFreshnessQuery },
      getScenarioSetBatchRunCount: { useQuery: mockGetBatchRunCount },
      cancelJob: {
        useMutation: vi.fn(() => ({
          mutate: mockCancelJob,
          isPending: false,
        })),
      },
      cancelBatchRun: {
        useMutation: vi.fn(() => ({
          mutate: mockCancelBatchRun,
          isPending: false,
        })),
      },
    },
    agents: { getAll: { useQuery: vi.fn(() => ({ data: [] })) } },
    prompts: {
      getAllPromptsForProject: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
  },
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, setFlowCallbacks: vi.fn() }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: mockRouterPush, isReady: true }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({
  formatTimeAgoCompact: () => "2h ago",
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const NOW = 1_700_000_000_000;
const SUITE_SET_ID = getSuiteSetId("suite_1");

const suitePlan: RunPlan = {
  slug: "checkout",
  name: "Checkout",
  kind: "suite",
  scenarioSetId: SUITE_SET_ID,
  suiteId: "suite_1",
  caseCount: 3,
  lastRun: null,
};

const period = {
  startDate: new Date(NOW - 30 * 86_400_000),
  endDate: new Date(NOW),
};

function makeRun(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    batchRunId: "batch_3",
    scenarioRunId: "run_1",
    name: "Angry refund request",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      metCriteria: ["a"],
      unmetCriteria: [],
    },
    messages: [],
    timestamp: NOW,
    durationInMs: 6300,
    totalCost: 0.0042,
    ...overrides,
  } as ScenarioRunData;
}

/** Three finished batches, newest first: batch_3, batch_2, batch_1. */
function threeBatches(): ScenarioRunData[] {
  return [
    makeRun({
      batchRunId: "batch_3",
      scenarioRunId: "run_3",
      timestamp: NOW,
      metadata: { note: "switched judge to the stricter rubric" },
    }),
    makeRun({
      batchRunId: "batch_2",
      scenarioRunId: "run_2",
      timestamp: NOW - 86_400_000,
    }),
    makeRun({
      batchRunId: "batch_1",
      scenarioRunId: "run_1",
      timestamp: NOW - 2 * 86_400_000,
      status: ScenarioRunStatus.FAILED,
      results: {
        verdict: Verdict.FAILURE,
        metCriteria: [],
        unmetCriteria: ["a"],
      },
    }),
  ];
}

function setRuns(
  runs: ScenarioRunData[],
  hasMore = false,
  nextCursor?: string,
) {
  mockGetSuiteRunData.mockReturnValue({
    data: { runs, scenarioSetIds: {}, hasMore, nextCursor, changed: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderDetail(
  overrides: Partial<React.ComponentProps<typeof RunPlanDetail>> = {},
) {
  const props: React.ComponentProps<typeof RunPlanDetail> = {
    plan: suitePlan,
    batchRunId: null,
    onSelectRun: vi.fn(),
    onBack: vi.fn(),
    onEditPlan: vi.fn(),
    period,
    periodMode: "relative",
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
    sseConnected: true,
    ...overrides,
  };
  const view = render(<RunPlanDetail {...props} />, { wrapper: Wrapper });
  return { props, view };
}

describe("<RunPlanDetail/>", () => {
  beforeEach(() => {
    useAgentTestingStore.setState({
      viewMode: "table",
      pendingBatchRunId: null,
      cancellingJobId: null,
    });
    mockGetBatchRunCount.mockReturnValue({ data: { count: 3 } });
    mockFreshnessQuery.mockReturnValue({ data: undefined });
    setRuns(threeBatches());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** @scenario "Choosing a run plan opens its runs" */
  it("lists the runs newest first and opens on the newest", () => {
    renderDetail();

    const sidebar = screen.getByTestId("agent-testing-runs-sidebar");
    const entries = within(sidebar).getAllByTestId(/^runs-sidebar-item-\w+$/);
    expect(entries).toHaveLength(3);
    expect(within(entries[0]!).getByText("Run #3")).toBeInTheDocument();
    expect(within(entries[1]!).getByText("Run #2")).toBeInTheDocument();
    expect(within(entries[2]!).getByText("Run #1")).toBeInTheDocument();
    expect(entries[0]).toHaveAttribute("data-selected", "true");
  });

  /** @scenario "Two runs never carry the same number" */
  it("numbers every run apart when the run count is behind the list", () => {
    // The run that has just finished is in the list before the count query
    // has read it again.
    mockGetBatchRunCount.mockReturnValue({ data: { count: 2 } });
    renderDetail();

    const sidebar = screen.getByTestId("agent-testing-runs-sidebar");
    const entries = within(sidebar).getAllByTestId(/^runs-sidebar-item-\w+$/);

    expect(within(entries[0]!).getByText("Run #3")).toBeInTheDocument();
    expect(within(entries[1]!).getByText("Run #2")).toBeInTheDocument();
    expect(within(entries[2]!).getByText("Run #1")).toBeInTheDocument();
  });

  /** @scenario "A sidebar entry shows the number, the note, the age and the pass rate" */
  it("shows the number, the note, the age and the pass rate on an entry", () => {
    renderDetail();

    const entry = screen.getByTestId("runs-sidebar-item-batch_3");
    expect(within(entry).getByText("Run #3")).toBeInTheDocument();
    expect(
      within(entry).getByText("switched judge to the stricter rubric"),
    ).toBeInTheDocument();
    expect(within(entry).getByText("2h ago")).toBeInTheDocument();
    expect(within(entry).getByText("100%")).toBeInTheDocument();
  });

  /** @scenario "The runs sidebar shows the note under the run entry" */
  it("shows the note under the run entry, with the age and the pass rate", () => {
    renderDetail();

    const entry = screen.getByTestId("runs-sidebar-item-batch_3");
    const note = within(entry).getByTestId("runs-sidebar-item-batch_3-note");
    expect(note).toHaveTextContent("switched judge to the stricter rubric");
    expect(within(entry).getByText("2h ago")).toBeInTheDocument();
    expect(within(entry).getByText("100%")).toBeInTheDocument();
  });

  /** @scenario "A run with no note shows no note line" */
  it("draws no note line on a run started without one", () => {
    renderDetail();

    const entry = screen.getByTestId("runs-sidebar-item-batch_2");
    expect(
      within(entry).queryByTestId("runs-sidebar-item-batch_2-note"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A long note is shortened in the sidebar and readable in full on hover" */
  it("shortens a long note to one line and keeps it readable on hover", () => {
    const longNote = "n".repeat(200);
    setRuns([makeRun({ batchRunId: "batch_3", metadata: { note: longNote } })]);
    renderDetail();

    const note = screen.getByTestId("runs-sidebar-item-batch_3-note");
    expect(note).toHaveAttribute("title", longNote);
  });

  /** @scenario "The selected run reads with a grey background and no coloured dot beside its name" */
  it("marks the selected run without a coloured dot beside its name", () => {
    renderDetail({ batchRunId: "batch_2" });

    const entry = screen.getByTestId("runs-sidebar-item-batch_2");
    expect(entry).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("runs-sidebar-item-batch_3")).not.toHaveAttribute(
      "data-selected",
    );

    // The name line carries no result mark; the line under it does.
    const title = within(entry).getByTestId("runs-sidebar-item-batch_2-title");
    expect(title.querySelectorAll("[class*='circle']")).toHaveLength(0);
    expect(
      within(entry).getByTestId("runs-sidebar-item-batch_2-result"),
    ).toBeInTheDocument();
  });

  /** @scenario "The runs sidebar loads more runs on request" */
  it("offers a control that adds the older runs below", async () => {
    const user = userEvent.setup();
    // The pages are built once: the hook accumulates on the identity of the
    // query result, so a fresh object per render would never settle.
    const firstPage = {
      data: {
        runs: threeBatches(),
        scenarioSetIds: {},
        hasMore: true,
        nextCursor: "cursor_2",
        changed: true,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    const secondPage = {
      data: {
        runs: [
          makeRun({
            batchRunId: "batch_0",
            scenarioRunId: "run_0",
            timestamp: NOW - 5 * 86_400_000,
          }),
        ],
        scenarioSetIds: {},
        hasMore: false,
        changed: true,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    mockGetSuiteRunData.mockImplementation((input: { cursor?: string }) =>
      input.cursor ? secondPage : firstPage,
    );

    renderDetail();

    const loadMore = screen.getByRole("button", { name: "Load More..." });
    await user.click(loadMore);

    expect(screen.getByTestId("runs-sidebar-item-batch_0")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^runs-sidebar-item-batch_\d+$/)).toHaveLength(
      4,
    );
  });

  /** @scenario "The results read as a table by default" */
  it("reads the results as a table with the verdict, the duration and the cost", () => {
    setRuns([
      makeRun({
        scenarioRunId: "run_a",
        name: "Angry refund request",
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: ["a", "b", "c"],
          unmetCriteria: [],
        },
      }),
    ]);
    renderDetail();

    const table = screen.getByTestId("run-results-table");
    expect(within(table).getByText("Passed (3/3)")).toBeInTheDocument();
    expect(within(table).getByText("Angry refund request")).toBeInTheDocument();
    expect(within(table).getByText("6.3s · $0.004200")).toBeInTheDocument();
  });

  /** @scenario "A row that has not settled shows no time and no cost" */
  it("shows no time and no cost while a case is still running", () => {
    setRuns([
      makeRun({
        scenarioRunId: "run_live",
        status: ScenarioRunStatus.IN_PROGRESS,
        results: null,
        // The stored row already carries the millisecond it started on.
        durationInMs: 1,
        totalCost: undefined,
      }),
    ]);
    const { view } = renderDetail();

    const table = screen.getByTestId("run-results-table");
    expect(within(table).queryByText(/1ms/)).not.toBeInTheDocument();

    setRuns([makeRun({ scenarioRunId: "run_live" })]);
    view.rerender(
      <Wrapper>
        <RunPlanDetail
          plan={suitePlan}
          batchRunId={null}
          onSelectRun={vi.fn()}
          onBack={vi.fn()}
          onEditPlan={vi.fn()}
          period={period}
          periodMode="relative"
          setPeriod={vi.fn()}
          setRelativePeriod={vi.fn()}
          sseConnected
        />
      </Wrapper>,
    );

    expect(
      within(screen.getByTestId("run-results-table")).getByText(
        "6.3s · $0.004200",
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "The row menu of a result opens the editor of the test case" */
  it("opens the editor of the test case from the row menu", async () => {
    const user = userEvent.setup();
    setRuns([makeRun({ scenarioRunId: "run_a", scenarioId: "scen_7" })]);
    renderDetail();

    await user.click(
      screen.getByRole("button", { name: /^Actions for / }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit test case" }),
    );

    expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioEditor", {
      urlParams: { variant: "agent-testing", scenarioId: "scen_7" },
    });
  });

  /** @scenario "Only the selected run is shown, not every previous run" */
  it("shows the results of the selected run alone", () => {
    setRuns([
      makeRun({
        batchRunId: "batch_3",
        scenarioRunId: "run_3",
        name: "Newest case",
      }),
      makeRun({
        batchRunId: "batch_2",
        scenarioRunId: "run_2",
        name: "Older case",
        timestamp: NOW - 86_400_000,
      }),
    ]);
    renderDetail({ batchRunId: "batch_2" });

    const table = screen.getByTestId("run-results-table");
    expect(within(table).getByText("Older case")).toBeInTheDocument();
    expect(within(table).queryByText("Newest case")).not.toBeInTheDocument();
    // The run that is not shown stays in the rail.
    expect(screen.getByTestId("runs-sidebar-item-batch_3")).toBeInTheDocument();
  });

  /** @scenario "The header of the results names the run plan and holds the actions" */
  it("names the run plan in the header and keeps the back control in the rail", () => {
    renderDetail();

    const detail = screen.getByTestId("agent-testing-run-plan-detail");
    expect(within(detail).getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("export-runs-button")).toBeInTheDocument();

    const sidebar = screen.getByTestId("agent-testing-runs-sidebar");
    expect(
      within(sidebar).getByRole("button", { name: /Run plans/ }),
    ).toBeInTheDocument();
  });

  /** @scenario "The run header shows the note of the selected run" */
  it("shows the note of the selected run beside its name", () => {
    renderDetail();

    const line = screen.getByTestId("run-summary-line");
    expect(within(line).getByText("Run #3")).toBeInTheDocument();
    expect(within(line).getByTestId("run-summary-note")).toHaveTextContent(
      "switched judge to the stricter rubric",
    );
  });

  /** @scenario "The classic grid can be switched on and stays on" */
  it("switches to the classic cards and writes the view into the address", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      screen.getByRole("button", { name: "Grid, watch the conversations" }),
    );

    expect(useAgentTestingStore.getState().viewMode).toBe("grid");
    expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
    expect(mockRouterPush).toHaveBeenCalledWith(
      { query: expect.objectContaining({ view: "grid" }) },
      undefined,
      { shallow: true },
    );
  });

  /** @scenario "A run that is still going updates without a reload" */
  it("moves a case from queued to its verdict as the data arrives", () => {
    setRuns([
      makeRun({
        scenarioRunId: "run_live",
        status: ScenarioRunStatus.QUEUED,
        results: null,
        durationInMs: 0,
        totalCost: undefined,
      }),
    ]);
    const { view } = renderDetail();
    expect(screen.getByText("Queued")).toBeInTheDocument();

    setRuns([
      makeRun({
        scenarioRunId: "run_live",
        status: ScenarioRunStatus.SUCCESS,
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: ["a"],
          unmetCriteria: [],
        },
      }),
    ]);
    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <RunPlanDetail
          plan={suitePlan}
          batchRunId={null}
          onSelectRun={vi.fn()}
          onBack={vi.fn()}
          onEditPlan={vi.fn()}
          period={period}
          periodMode="relative"
          setPeriod={vi.fn()}
          setRelativePeriod={vi.fn()}
          sseConnected
        />
      </ChakraProvider>,
    );

    expect(screen.getByText("Passed (1/1)")).toBeInTheDocument();
    expect(screen.queryByText("Queued")).not.toBeInTheDocument();
  });

  /** @scenario "When the live connection drops the results still update" */
  it("keeps refreshing on the fallback cadence when the live stream is down", () => {
    renderDetail({ sseConnected: false });

    const options = mockFreshnessQuery.mock.calls.at(-1)?.[1] as {
      refetchInterval: number | false;
    };
    expect(typeof options.refetchInterval).toBe("number");
    expect(screen.queryByText(/reload/i)).not.toBeInTheDocument();
  });

  /** @scenario "One case in a running batch can be stopped on its own" */
  it("stops one running case on its own", async () => {
    const user = userEvent.setup();
    setRuns([
      makeRun({
        scenarioRunId: "run_running",
        status: ScenarioRunStatus.IN_PROGRESS,
        results: null,
      }),
      makeRun({
        scenarioRunId: "run_other",
        scenarioId: "scen_2",
        name: "Edge: empty cart",
        status: ScenarioRunStatus.IN_PROGRESS,
        results: null,
      }),
    ]);
    renderDetail();

    const stops = screen.getAllByTestId("cancel-run-button");
    expect(stops).toHaveLength(2);
    await user.click(stops[0]!);

    expect(mockCancelJob).toHaveBeenCalledWith({
      projectId: "proj_1",
      scenarioSetId: SUITE_SET_ID,
      batchRunId: "batch_3",
      scenarioRunId: "run_running",
      scenarioId: "scen_1",
    });
    // The other case keeps its own Stop, so it is still going.
    expect(screen.getAllByTestId("cancel-run-button")).toHaveLength(2);
  });

  /** @scenario "A whole running batch can be stopped at once" */
  it("stops a whole running batch at once", async () => {
    const user = userEvent.setup();
    setRuns([
      makeRun({
        scenarioRunId: "run_running",
        status: ScenarioRunStatus.IN_PROGRESS,
        results: null,
      }),
      makeRun({
        scenarioRunId: "run_queued",
        scenarioId: "scen_2",
        status: ScenarioRunStatus.QUEUED,
        results: null,
      }),
      makeRun({ scenarioRunId: "run_done", scenarioId: "scen_3" }),
    ]);
    renderDetail();

    await user.click(screen.getByTestId("stop-all-button"));

    expect(mockCancelBatchRun).toHaveBeenCalledWith({
      projectId: "proj_1",
      scenarioSetId: SUITE_SET_ID,
      batchRunId: "batch_3",
    });
    // The case that already finished keeps its verdict.
    expect(screen.getByText("Passed (1/1)")).toBeInTheDocument();
  });

  /** @scenario "Stop is not offered for a case that already finished" */
  it("offers no Stop when every case finished", () => {
    renderDetail();

    expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stop-all-button")).not.toBeInTheDocument();
  });

  /** @scenario "A run that stopped reporting reads as stalled" */
  it("reads a run that stopped reporting as stalled and counts it as finished", () => {
    setRuns([
      makeRun({
        scenarioRunId: "run_stalled",
        status: ScenarioRunStatus.STALLED,
        results: null,
      }),
    ]);
    renderDetail();

    expect(screen.getByText("Stalled")).toBeInTheDocument();
    // Settled, so no Stop is offered and the batch is not running.
    expect(screen.queryByTestId("cancel-run-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stop-all-button")).not.toBeInTheDocument();
  });

  /** @scenario "The results of a run plan can be exported as CSV" */
  it("opens the export dialog and starts the download on confirm", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    renderDetail();

    await user.click(screen.getByTestId("export-runs-button"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Export Scenario Runs"),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Export/i }));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/export/scenario-runs/download",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as { body: string }).body,
    ) as { scenarioSetId: string; mode: string };
    expect(body.scenarioSetId).toBe(SUITE_SET_ID);
    expect(body.mode).toBe("full");

    fetchSpy.mockRestore();
  });

  /** @scenario "A run plan with no run in the period says so" */
  it("says a plan has no run inside the period and offers to widen it", async () => {
    const user = userEvent.setup();
    setRuns([]);
    const { props } = renderDetail();

    expect(screen.getByText("No run in this period")).toBeInTheDocument();
    await user.click(screen.getByTestId("widen-period-button"));
    expect(props.setRelativePeriod).toHaveBeenCalledWith("90d");
  });

  /** @scenario "Each run under One-off runs is named for the test case that ran" */
  /** @scenario "The finished one-off run is listed under One-off runs" */
  it("names a one-off run after the test case that ran", async () => {
    const user = userEvent.setup();
    setRuns([
      makeRun({
        batchRunId: "batch_b",
        scenarioRunId: "run_b",
        name: "Angry refund request",
      }),
      makeRun({
        batchRunId: "batch_a",
        scenarioRunId: "run_a",
        scenarioId: "scen_2",
        name: "Edge: empty cart",
        timestamp: NOW - 86_400_000,
      }),
    ]);
    const { props } = renderDetail({
      plan: {
        slug: "one-off-runs",
        name: "One-off runs",
        kind: "one-off",
        scenarioSetId: "__internal__proj_1__on-platform-scenarios",
        suiteId: null,
        caseCount: null,
        lastRun: null,
      },
    });

    const sidebar = screen.getByTestId("agent-testing-runs-sidebar");
    expect(
      within(sidebar).getByText("Angry refund request"),
    ).toBeInTheDocument();
    expect(within(sidebar).getByText("Edge: empty cart")).toBeInTheDocument();

    await user.click(within(sidebar).getByText("Edge: empty cart"));
    expect(props.onSelectRun).toHaveBeenCalledWith("batch_a");
  });

  it("opens the run detail drawer when a result row is chosen", async () => {
    const user = userEvent.setup();
    setRuns([makeRun({ scenarioRunId: "run_a" })]);
    renderDetail();

    await user.click(screen.getByText("Angry refund request"));

    expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
      urlParams: {
        variant: "agent-testing",
        scenarioRunId: "run_a",
        batchRunId: "batch_3",
        scenarioSetId: SUITE_SET_ID,
      },
    });
  });

  it("holds a place for a run that was just started", () => {
    useAgentTestingStore.setState({ pendingBatchRunId: "batch_new" });
    renderDetail();

    expect(screen.getByTestId("runs-sidebar-pending")).toBeInTheDocument();
  });
});
