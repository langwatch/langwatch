/**
 * @vitest-environment jsdom
 *
 * One run plan: the runs in the rail, and the results of the selected run as
 * a table or as the classic grid.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
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
import { RUN_AGAIN_LABEL } from "../results/RunPlanDetailHeader";
import { PROJECT_DEFAULT_MODEL } from "../results/RunSettingsBlock";
import { RunsSidebarEntry } from "../results/RunsSidebarEntry";
import type { RunPlan } from "../results/run-plans";
import { passRateColor } from "../shared/pass-rate-color";
import { useAgentTestingStore } from "../useAgentTestingStore";

const mockGetSuiteRunData = vi.hoisted(() => vi.fn());
const mockGetBatchRunCount = vi.hoisted(() => vi.fn());
const mockFreshnessQuery = vi.hoisted(() => vi.fn());
const mockCancelJob = vi.hoisted(() => vi.fn());
const mockCancelBatchRun = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
// Honors `enabled` the way the real query does, so a test proves both that
// the roster reaches the row and that it is not fetched when no name is
// wanted.
const mockGetOrganizationMembers = vi.hoisted(() =>
  vi.fn((_input: unknown, options?: { enabled?: boolean }) =>
    options?.enabled === false
      ? { data: undefined }
      : {
          data: {
            members: [
              { user: { id: "user_omar", name: "Omar Haddad", image: null } },
              // A member with no name of their own never reaches the row.
              { user: { id: "user_nameless", name: null, image: null } },
            ],
          },
        },
  ),
);
const mockGetSuiteById = vi.hoisted(() =>
  vi.fn(() => ({
    data: {
      id: "suite_1",
      name: "Checkout",
      scenarioIds: ["scen_1"],
      targets: [],
    },
  })),
);

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
      getAll: { useQuery: vi.fn(() => ({ data: [], isLoading: false })) },
      run: {
        useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
      },
      getSuiteRunData: { useQuery: mockGetSuiteRunData },
      // The run dialog lists the previous configurations of the scope it
      // opens on, which it reads off the runs.
      getRunConfigurations: { useQuery: vi.fn(() => ({ data: [] })) },
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
    suites: {
      // The run dialog offers the previous configurations of a scope, which
      // it reads from the run plans and the test suites of the project.
      getAll: { useQuery: () => ({ data: [] }) },
      testSuites: { getAll: { useQuery: () => ({ data: [] }) } },
      create: {
        useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
      },
      getById: { useQuery: mockGetSuiteById },
      run: {
        useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
      },
      runPlan: {
        useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
      },
      update: {
        useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
      },
    },
    prompts: {
      getAllPromptsForProject: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false })),
      },
      // The run settings block reads a model back through LLMModelDisplay,
      // which takes the provider icon from the providers of the project.
      listAllForProjectForFrontend: {
        useQuery: vi.fn(() => ({
          data: {
            providers: [
              {
                provider: "openai",
                enabled: true,
                customKeys: null,
                models: null,
                embeddingsModels: null,
                customModels: null,
                customEmbeddingsModels: null,
                deploymentMapping: null,
                extraHeaders: null,
              },
            ],
          },
          isLoading: false,
        })),
      },
    },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
    // The settings row names a teammate from the organization roster, the
    // same query the other non-admin member pickers read.
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: mockGetOrganizationMembers,
      },
    },
  },
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
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

// The settings block names the reader by comparing the run's actor with the
// signed-in user, so the test controls who is reading.
const VIEWER_USER_ID = "user_lena";
vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: VIEWER_USER_ID } },
    status: "authenticated",
    update: vi.fn(),
  }),
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
  scopeKind: "test_suites",
  scopeLabel: "3 scenarios",
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
      metadata: { note: "switched judge to the stricter criterion" },
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
    isSseConnected: true,
    ...overrides,
  };
  const view = render(<RunPlanDetail {...props} />, { wrapper: Wrapper });
  return { props, view };
}

describe("<RunPlanDetail/>", () => {
  beforeEach(() => {
    useAgentTestingStore.setState({
      viewMode: "table",
      pendingRun: null,
      cancellingJobId: null,
    });
    mockGetBatchRunCount.mockReturnValue({ data: { count: 3 } });
    mockFreshnessQuery.mockReturnValue({ data: undefined });
    setRuns(threeBatches());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Restores spies a test installed on globals. A test that fails before
    // its own restore would otherwise leave the stub in place for every test
    // after it.
    vi.restoreAllMocks();
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
      within(entry).getByText("switched judge to the stricter criterion"),
    ).toBeInTheDocument();
    expect(within(entry).getByText("2h ago")).toBeInTheDocument();
    expect(within(entry).getByText("100%")).toBeInTheDocument();
  });

  /** @scenario "The runs sidebar shows the note under the run entry" */
  it("shows the note under the run entry, with the age and the pass rate", () => {
    renderDetail();

    const entry = screen.getByTestId("runs-sidebar-item-batch_3");
    const note = within(entry).getByTestId("runs-sidebar-item-batch_3-note");
    expect(note).toHaveTextContent("switched judge to the stricter criterion");
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
  it("shows no time and no cost while a scenario is still running", () => {
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
          isSseConnected
        />
      </Wrapper>,
    );

    expect(
      within(screen.getByTestId("run-results-table")).getByText(
        "6.3s · $0.004200",
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "The row menu of a result opens the editor of the scenario" */
  it("opens the editor of the scenario from the row menu", async () => {
    const user = userEvent.setup();
    setRuns([makeRun({ scenarioRunId: "run_a", scenarioId: "scen_7" })]);
    renderDetail();

    await user.click(screen.getByRole("button", { name: /^Actions for / }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit scenario" }),
    );

    expect(mockOpenDrawer).toHaveBeenCalledWith("agentTestingCaseEditor", {
      scenarioId: "scen_7",
    });
  });

  /** @scenario "The row menu of a result runs the scenario again on its own" */
  it("offers the conversation and a rerun on the row menu", async () => {
    const user = userEvent.setup();
    setRuns([makeRun({ scenarioRunId: "run_a", scenarioId: "scen_7" })]);
    renderDetail();

    await user.click(screen.getByRole("button", { name: /^Actions for / }));

    expect(
      await screen.findByRole("menuitem", { name: "Open the conversation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Rerun this scenario" }),
    ).toBeInTheDocument();
  });

  /** @scenario "A run plan is run again from the header of its results" */
  it("opens the run dialog on the plan from the header Run control", async () => {
    const user = userEvent.setup();
    renderDetail();

    expect(
      screen.getByRole("button", { name: "Edit run plan" }),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("run-plan-button"));

    const dialog = await screen.findByTestId("run-dialog");
    expect(dialog).toHaveTextContent("Run · Checkout");
  });

  /** @scenario "Edit run plan opens the run dialog on the configuration of the plan" */
  it("opens the plan in the run dialog from Edit run plan, left of Run", async () => {
    const user = userEvent.setup();
    const { props } = renderDetail();

    const line = screen.getByTestId("run-summary-line");
    const edit = within(line).getByTestId("edit-run-plan-button");
    const run = within(line).getByTestId("run-plan-button");
    expect(edit).toHaveTextContent("Edit run plan");
    expect(
      edit.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(edit);
    // The dialog host holds the plan the id names, so the page hands it the
    // suite of the open plan rather than opening an empty dialog.
    expect(props.onEditPlan).toHaveBeenCalledWith("suite_1");
  });

  /** @scenario "A set that runs from code has no Run and no Edit run plan" */
  it("offers neither Run nor Edit run plan on a set that runs from code", () => {
    renderDetail({
      plan: {
        slug: "external:nightly-ci",
        name: "nightly-ci",
        kind: "external",
        scopeKind: "external",
        scopeLabel: "from code",
        scenarioSetId: "nightly-ci",
        suiteId: null,
        caseCount: null,
        lastRun: null,
      },
    });

    expect(screen.queryByTestId("run-plan-button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("edit-run-plan-button"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Only the selected run is shown, not every previous run" */
  it("shows the results of the selected run alone", () => {
    setRuns([
      makeRun({
        batchRunId: "batch_3",
        scenarioRunId: "run_3",
        name: "Newest scenario",
      }),
      makeRun({
        batchRunId: "batch_2",
        scenarioRunId: "run_2",
        name: "Older scenario",
        timestamp: NOW - 86_400_000,
      }),
    ]);
    renderDetail({ batchRunId: "batch_2" });

    const table = screen.getByTestId("run-results-table");
    expect(within(table).getByText("Older scenario")).toBeInTheDocument();
    expect(
      within(table).queryByText("Newest scenario"),
    ).not.toBeInTheDocument();
    // The run that is not shown stays in the rail.
    expect(screen.getByTestId("runs-sidebar-item-batch_3")).toBeInTheDocument();
  });

  /** @scenario "The results header holds the run and the actions on one line" */
  it("holds the run and the actions on one line, with the back control in the rail", () => {
    renderDetail();

    // The name of the plan is the page title now, so the line itself carries
    // the run and the actions of the plan.
    const line = screen.getByTestId("run-summary-line");
    expect(within(line).getByText("Run #3")).toBeInTheDocument();
    expect(within(line).getByTestId("view-mode-toggle")).toBeInTheDocument();
    expect(
      within(line).getByRole("button", { name: "More actions for Checkout" }),
    ).toBeInTheDocument();
    expect(within(line).getByTestId("run-plan-button")).toBeInTheDocument();

    const sidebar = screen.getByTestId("agent-testing-runs-sidebar");
    expect(
      within(sidebar).getByRole("button", { name: /Results/ }),
    ).toBeInTheDocument();
  });

  // The three read left to right in one order. They are found by their own
  // handles and compared by document position, so a header that put the note
  // before the pass block would fail rather than pass on the order the
  // assertions are written in.
  /** @scenario "The run header reads the run, then the pass block, then the note" */
  it("reads the run number, then the pass block, then the note", () => {
    renderDetail();

    const line = screen.getByTestId("run-summary-line");
    const number = within(line).getByText("Run #3");
    const pass = within(line).getByTestId("run-metrics-summary");
    const note = within(line).getByTestId("run-summary-note");

    expect(
      number.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      pass.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /** @scenario "The runs sidebar holds only the back link and the run list" */
  it("holds only the back link and the runs, never the name of the plan", () => {
    renderDetail();

    const sidebar = screen.getByTestId("agent-testing-runs-sidebar");
    expect(
      within(sidebar).getByRole("button", { name: /Results/ }),
    ).toBeInTheDocument();
    expect(within(sidebar).getByText("Run #3")).toBeInTheDocument();

    // The plan name is the page title while the plan is open, so repeating it
    // in the rail would say the same thing twice on one screen.
    expect(within(sidebar).queryByText("Checkout")).not.toBeInTheDocument();
  });

  /** @scenario "The results header holds the run and the actions on one line" */
  it("reads the run, then how it went, then the note, with its age beside the toggle", () => {
    renderDetail();

    const line = screen.getByTestId("run-summary-line");
    const positionOf = (element: Element) => {
      const all = [...line.querySelectorAll("*")];
      return all.indexOf(element);
    };

    const name = within(line).getByText("Run #3");
    const summary = within(line).getByTestId("run-metrics-summary");
    const note = within(line).getByTestId("run-summary-note");
    const settings = within(line).getByTestId("run-settings-toggle");
    const toggle = within(line).getByTestId("view-mode-toggle");
    const edit = within(line).getByTestId("edit-run-plan-button");
    const runControl = within(line).getByTestId("run-plan-button");

    expect(positionOf(name)).toBeLessThan(positionOf(summary));
    expect(positionOf(summary)).toBeLessThan(positionOf(note));
    expect(positionOf(note)).toBeLessThan(positionOf(settings));
    expect(positionOf(settings)).toBeLessThan(positionOf(toggle));
    expect(positionOf(toggle)).toBeLessThan(positionOf(edit));
    expect(positionOf(edit)).toBeLessThan(positionOf(runControl));
  });

  /**
   * The layout is read off the emitted rules, because jsdom lays nothing out.
   * Three of them carry the whole rule: the actions never shrink, the run
   * summary takes what is left and may shrink to nothing, and the line packs
   * to its right end, which is where the actions stay if it ever has to break.
   */
  /** @scenario "A note never moves the actions of the header line" */
  it("keeps the actions at the right end however long the note is", () => {
    const longNote = "n".repeat(200);
    setRuns([makeRun({ batchRunId: "batch_3", metadata: { note: longNote } })]);
    renderDetail();

    const line = screen.getByTestId("run-summary-line");
    const summary = within(line).getByTestId("run-summary-run");
    const actions = within(line).getByTestId("run-summary-actions");

    expect(line).toHaveStyle({ justifyContent: "flex-end" });
    expect(actions).toHaveStyle({ flexShrink: "0" });
    expect(summary).toHaveStyle({ flexGrow: "1" });

    // The note is what gives the space back, and the whole of it stays
    // readable on the note itself.
    const note = within(line).getByTestId("run-summary-note");
    expect(note).toHaveAttribute("title", longNote);
    expect(note).toHaveStyle({ textOverflow: "ellipsis", minWidth: "0px" });
  });

  /** @scenario "The run control of an open run offers to run it again" */
  it("reads Run again on the control of an open run", () => {
    renderDetail();

    const line = screen.getByTestId("run-summary-line");
    expect(within(line).getByTestId("run-plan-button")).toHaveTextContent(
      RUN_AGAIN_LABEL,
    );
    expect(
      within(line).queryByRole("button", { name: "Run" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The header line does not repeat when the run started" */
  it("leaves how long ago the run started off the header line", async () => {
    const user = userEvent.setup();
    renderDetail();

    const line = screen.getByTestId("run-summary-line");
    expect(within(line).queryByText("2h ago")).not.toBeInTheDocument();

    // The rail still says it, and the settings block says it again with the
    // date, so nothing was lost by taking it off the line.
    const sidebar = screen.getByTestId("agent-testing-runs-sidebar");
    expect(within(sidebar).getAllByText("2h ago").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Show run settings" }));
    expect(screen.getByTestId("run-settings-started")).toHaveTextContent(
      "2h ago",
    );
  });

  /** @scenario "The run header shows the note of the selected run" */
  it("shows the note of the selected run beside its name", () => {
    renderDetail();

    const line = screen.getByTestId("run-summary-line");
    expect(within(line).getByText("Run #3")).toBeInTheDocument();
    expect(within(line).getByTestId("run-summary-note")).toHaveTextContent(
      "switched judge to the stricter criterion",
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

  /** @scenario "The cards of the grid line up with the line above them" */
  it("draws the grid with no padding of its own", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      screen.getByRole("button", { name: "Grid, watch the conversations" }),
    );

    // The results column is already padded, so the grid adds none: the first
    // card starts where the summary line above it starts.
    const grid = screen.getByTestId("scenario-grid");
    expect(grid).toHaveStyle({ padding: "0px" });
  });

  /** @scenario "A run that is still going updates without a reload" */
  it("moves a scenario from queued to its verdict as the data arrives", () => {
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
          isSseConnected
        />
      </ChakraProvider>,
    );

    expect(screen.getByText("Passed (1/1)")).toBeInTheDocument();
    expect(screen.queryByText("Queued")).not.toBeInTheDocument();
  });

  /** @scenario "When the live connection drops the results still update" */
  it("keeps refreshing on the fallback cadence when the live stream is down", () => {
    renderDetail({ isSseConnected: false });

    const options = mockFreshnessQuery.mock.calls.at(-1)?.[1] as {
      refetchInterval: number | false;
    };
    expect(typeof options.refetchInterval).toBe("number");
    expect(screen.queryByText(/reload/i)).not.toBeInTheDocument();
  });

  /** @scenario "One scenario in a running batch can be stopped on its own" */
  it("stops one running scenario on its own", async () => {
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
    // The other scenario keeps its own Stop, so it is still going.
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
    // The scenario that already finished keeps its verdict.
    expect(screen.getByText("Passed (1/1)")).toBeInTheDocument();
  });

  /** @scenario "Stop is not offered for a scenario that already finished" */
  it("offers no Stop when every scenario finished", () => {
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

    await user.click(
      screen.getByRole("button", { name: "More actions for Checkout" }),
    );
    await user.click(await screen.findByTestId("export-runs-button"));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Export Scenario Runs"),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Export/i }));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/export/scenario-runs/download",
      expect.objectContaining({ method: "POST" }),
    );
    // Picked by URL, not by position: the page fetches other things too.
    const exportCall = fetchSpy.mock.calls.find(
      (call) => call[0] === "/api/export/scenario-runs/download",
    );
    const body = JSON.parse((exportCall![1] as { body: string }).body) as {
      scenarioSetId: string;
      mode: string;
    };
    expect(body.scenarioSetId).toBe(SUITE_SET_ID);
    expect(body.mode).toBe("full");
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

  /**
   * One batch of three runs of one scenario against one target, started with
   * one parameter and both simulation models named. The repeat count is the
   * number of runs sharing a scenario and a target, so three runs is a repeat
   * count of three.
   */
  function configuredBatch(
    langwatch: Record<string, unknown> = {
      targetReferenceId: "agent_1",
      targetType: "http",
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5",
    },
    extraMetadata: Record<string, unknown> = {
      parameters: { region: "eu-central" },
    },
  ): ScenarioRunData[] {
    return ["run_a", "run_b", "run_c"].map((scenarioRunId) =>
      makeRun({
        batchRunId: "batch_3",
        scenarioRunId,
        metadata: { langwatch, ...extraMetadata } as never,
      }),
    );
  }

  /** @scenario "The run settings stay hidden until they are asked for" */
  it("keeps the run settings off until the toggle is used", () => {
    setRuns(configuredBatch());
    renderDetail();

    const toggle = screen.getByTestId("run-settings-toggle");
    expect(toggle).toHaveTextContent("Show run settings");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("run-settings-block")).not.toBeInTheDocument();
    // Nothing pushed the results down: the table is what reads under the
    // header line.
    expect(screen.getByTestId("run-results-table")).toBeInTheDocument();
  });

  /** @scenario "The toggle turns the run settings block on and off" */
  it("turns the block on with the toggle and off again", async () => {
    const user = userEvent.setup();
    setRuns(configuredBatch());
    renderDetail();

    const toggle = screen.getByTestId("run-settings-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(screen.getByTestId("run-settings-block")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(screen.queryByTestId("run-settings-block")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  /** @scenario "The run settings block says what the run was configured with" */
  it("reads the parameters, the repeat count and both models", async () => {
    const user = userEvent.setup();
    setRuns(configuredBatch());
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const block = screen.getByTestId("run-settings-block");
    expect(within(block).getByTestId("run-settings-started")).toHaveTextContent(
      "2h ago",
    );
    // A parameter value is a literal, so it reads in a monospace font.
    const parameter = within(block).getByText("region = eu-central");
    expect(parameter.tagName).toBe("CODE");

    expect(within(block).getByTestId("run-settings-repeat")).toHaveTextContent(
      "3 times",
    );

    const simulator = within(block).getByTestId("run-settings-simulator");
    expect(simulator).toHaveTextContent("gpt-5-mini");
    expect(simulator.querySelector("svg")).not.toBeNull();

    const judge = within(block).getByTestId("run-settings-judge");
    expect(judge).toHaveTextContent("gpt-5");
    expect(judge.querySelector("svg")).not.toBeNull();
  });

  /** @scenario "The block names the models the run really ran on" */
  /** @scenario "The run settings read the resolved model, not the configured one" */
  it("names the models the run resolved, never the project default", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({
        targetReferenceId: "agent_1",
        targetType: "http",
        resolvedSimulatorModel: "openai/gpt-5-mini",
        resolvedJudgeModel: "openai/gpt-5",
      }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const block = screen.getByTestId("run-settings-block");
    const simulator = within(block).getByTestId("run-settings-simulator");
    expect(simulator).toHaveTextContent("gpt-5-mini");
    expect(simulator.querySelector("svg")).not.toBeNull();

    const judge = within(block).getByTestId("run-settings-judge");
    expect(judge).toHaveTextContent("gpt-5");
    expect(judge.querySelector("svg")).not.toBeNull();

    expect(block).not.toHaveTextContent(PROJECT_DEFAULT_MODEL);
  });

  /** @scenario "The judge always reads, and a run that named no model reads the project default" */
  it("reads the judge as the project default on a run that stamped no model", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({ targetReferenceId: "agent_1", targetType: "http" }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const block = screen.getByTestId("run-settings-block");
    // Such a run judged on the default model of the project, so the row says
    // that rather than reading as if no judge had run at all.
    const judge = within(block).getByTestId("run-settings-judge");
    expect(judge).toHaveTextContent("Project default model");
    expect(judge).not.toHaveTextContent(/no model/i);
    expect(PROJECT_DEFAULT_MODEL).toBe("Project default model");
    // The simulator reads only when the run named one, so a run that named
    // neither model keeps the block to the judge alone.
    expect(
      within(block).queryByTestId("run-settings-simulator"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A run with no parameters and no repeat reads neither" */
  it("reads neither parameters nor a repeat count when the run had none", async () => {
    const user = userEvent.setup();
    setRuns([
      makeRun({
        batchRunId: "batch_3",
        scenarioRunId: "run_a",
        metadata: {
          langwatch: { targetReferenceId: "agent_1", targetType: "http" },
        } as never,
      }),
    ]);
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const block = screen.getByTestId("run-settings-block");
    expect(
      within(block).queryByTestId("run-settings-parameters"),
    ).not.toBeInTheDocument();
    expect(
      within(block).queryByTestId("run-settings-repeat"),
    ).not.toBeInTheDocument();
    // The judge still reads, which is the point of the block.
    expect(within(block).getByTestId("run-settings-judge")).toBeInTheDocument();
  });

  /** @scenario "The first row of the block says when the run started and who started it" */
  it("says when the run started and that the reader started it, on one row", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({
        targetReferenceId: "agent_1",
        targetType: "http",
        judgeModel: "openai/gpt-5",
        actorId: VIEWER_USER_ID,
        actorLabel: "user",
      }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const started = within(
      screen.getByTestId("run-settings-block"),
    ).getByTestId("run-settings-started");
    expect(started).toHaveTextContent("2h ago");
    // One row, not two: the person reads at the end of the row the time is on.
    expect(screen.getAllByTestId("run-settings-started")).toHaveLength(1);
    expect(started.textContent?.trim().endsWith("You")).toBe(true);
    // The reader names themselves, so the roster is never asked for.
    expect(mockGetOrganizationMembers).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: true }),
    );
  });

  /** @scenario "A run started by a teammate reads that teammate's name" */
  it("names the teammate who started the run, from the organization roster", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({
        targetReferenceId: "agent_1",
        targetType: "http",
        judgeModel: "openai/gpt-5",
        actorId: "user_omar",
        actorLabel: "user",
      }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const started = within(
      screen.getByTestId("run-settings-block"),
    ).getByTestId("run-settings-started");
    expect(started).toHaveTextContent("Omar Haddad");
    // Somebody else started it, so the reader is not named.
    expect(started).not.toHaveTextContent("You");
    expect(started).not.toHaveTextContent("user_omar");
    // The roster was asked for, against this organization.
    expect(mockGetOrganizationMembers).toHaveBeenCalledWith(
      { organizationId: "org_1" },
      expect.objectContaining({ enabled: true }),
    );
  });

  /** @scenario "A run whose person matches no member reads the time alone" */
  it("reads the time alone for a person no membership holds", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({
        targetReferenceId: "agent_1",
        targetType: "http",
        judgeModel: "openai/gpt-5",
        actorId: "user_departed",
        actorLabel: "user",
      }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const started = within(
      screen.getByTestId("run-settings-block"),
    ).getByTestId("run-settings-started");
    expect(started).toHaveTextContent("2h ago");
    expect(started).not.toHaveTextContent("Unknown");
    expect(started).not.toHaveTextContent("user_departed");
    // The row ends at the time, with no separator left behind it.
    expect(started.textContent?.trim().endsWith("2h ago")).toBe(true);
  });

  /** @scenario "A run whose person matches no member reads the time alone" */
  it("reads the time alone for a member whose row carries no name", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({
        targetReferenceId: "agent_1",
        targetType: "http",
        judgeModel: "openai/gpt-5",
        actorId: "user_nameless",
        actorLabel: "user",
      }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const started = within(
      screen.getByTestId("run-settings-block"),
    ).getByTestId("run-settings-started");
    expect(started.textContent?.trim().endsWith("2h ago")).toBe(true);
  });

  /** @scenario "A run started with a key that names no person shows only the time" */
  it("reads the time alone when the run recorded no person", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({
        targetReferenceId: "agent_1",
        targetType: "http",
        judgeModel: "openai/gpt-5",
      }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const started = within(
      screen.getByTestId("run-settings-block"),
    ).getByTestId("run-settings-started");
    expect(started).toHaveTextContent("2h ago");
    expect(started).not.toHaveTextContent("You");
    expect(started).not.toHaveTextContent("Unknown");
    // The row ends at the time, with no separator left behind it.
    expect(started.textContent?.trim().endsWith("2h ago")).toBe(true);
  });

  /** @scenario "A run started through the CLI names the CLI, not a person" */
  it("names the CLI on a run started through it, and invents no name", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch({
        targetReferenceId: "agent_1",
        targetType: "http",
        judgeModel: "openai/gpt-5",
        actorId: "user_omar",
        actorLabel: "cli",
      }),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    const started = within(
      screen.getByTestId("run-settings-block"),
    ).getByTestId("run-settings-started");
    expect(started).toHaveTextContent("CLI");
    // The run stores an id, so no name is made up from it, and the surface
    // answers for the run even when the roster holds that id.
    expect(started).not.toHaveTextContent("user_omar");
    expect(started).not.toHaveTextContent("Omar Haddad");
    expect(started).not.toHaveTextContent("You");
  });

  /** @scenario "The note stays in the header line and never moves into the block" */
  it("keeps the note in the header line when the settings are shown", async () => {
    const user = userEvent.setup();
    setRuns(
      configuredBatch(
        {
          targetReferenceId: "agent_1",
          targetType: "http",
          judgeModel: "openai/gpt-5",
        },
        { note: "switched judge to the stricter criterion" },
      ),
    );
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Show run settings" }));

    expect(
      within(screen.getByTestId("run-summary-line")).getByTestId(
        "run-summary-note",
      ),
    ).toHaveTextContent("switched judge to the stricter criterion");
    expect(screen.getByTestId("run-settings-block")).not.toHaveTextContent(
      "switched judge",
    );
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
    useAgentTestingStore.setState({
      pendingRun: { batchRunId: "batch_new", scenarioSetId: SUITE_SET_ID },
    });
    renderDetail();

    expect(screen.getByTestId("runs-sidebar-pending")).toBeInTheDocument();
  });

  it("holds no place for a run that another plan started", () => {
    useAgentTestingStore.setState({
      pendingRun: {
        batchRunId: "batch_new",
        scenarioSetId: getSuiteSetId("suite_other"),
      },
    });
    renderDetail();

    expect(
      screen.queryByTestId("runs-sidebar-pending"),
    ).not.toBeInTheDocument();
  });
});

describe("<RunsSidebarEntry/>", () => {
  afterEach(cleanup);

  /** @scenario "The runs sidebar reads a pass rate on the same scale as the tables" */
  it("reads a pass rate on the colour scale the whole surface shares", () => {
    render(
      <>
        <RunsSidebarEntry
          title="Run #2"
          note={null}
          timeAgo="now"
          passRate={90}
          passedCount={null}
          isSelected={false}
          testId="entry-90"
        />
        <RunsSidebarEntry
          title="Run #1"
          note={null}
          timeAgo="now"
          passRate={60}
          passedCount={null}
          isSelected={false}
          testId="entry-60"
        />
      </>,
      { wrapper: Wrapper },
    );

    const colorOf = (element: Element) =>
      window.getComputedStyle(element).color;
    const backgroundOf = (element: Element) =>
      window.getComputedStyle(element).backgroundColor;

    const ninety = screen.getByTestId("entry-90-result");
    const sixty = screen.getByTestId("entry-60-result");
    const ninetyText = within(ninety).getByTestId("pass-rate-text");
    const sixtyText = within(sixty).getByTestId("pass-rate-text");

    // Both rates sit in the same band of the surface's scale, so the raw
    // gradient of a rate would give them two colours and the scale gives
    // them one.
    // The scale answers a theme token; the element carries it as the
    // variable the theme emits for it.
    const tokenVar = (token: string) =>
      `var(--chakra-colors-${token.replace(".", "-")})`;
    expect(colorOf(ninetyText)).toBe(tokenVar(passRateColor(90)));
    expect(colorOf(sixtyText)).toBe(tokenVar(passRateColor(60)));
    expect(colorOf(ninetyText)).toBe(colorOf(sixtyText));

    expect(backgroundOf(screen.getByTestId("entry-90-result-dot"))).toBe(
      colorOf(ninetyText),
    );
  });
});
