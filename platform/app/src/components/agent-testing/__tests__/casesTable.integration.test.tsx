/**
 * @vitest-environment jsdom
 *
 * The table of scenarios of the open suite: which suite that is, what a row
 * says, and what its Run button and row menu do.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { CasesPanel } from "../cases/CasesPanel";
import type { CaseLastResult } from "../cases/CasesTable";
import type { TestCase, TestSuiteEntry } from "../cases/test-cases";
import { useSuiteRecentRuns } from "../cases/useSuiteRecentRuns";
import { useTestCasesView } from "../cases/useTestCasesView";
import type { AgentTestingSelection } from "../useAgentTestingRouting";

const suiteRunDataQuery = vi.hoisted(() => vi.fn());
const suitesGetAllQuery = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    suites: {
      // Every run of the v2 dialog is queued under a plan name.
      runPlan: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      // The run plans the recent runs belong to, for the name a row reads.
      getAll: { useQuery: suitesGetAllQuery },
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getScenarioSetRunData: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
      getSuiteRunData: { useQuery: suiteRunDataQuery },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    projectId: "proj_1",
  }),
}));

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: routerPush,
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const PERIOD = {
  startDate: new Date("2026-07-01T00:00:00.000Z"),
  endDate: new Date("2026-07-31T00:00:00.000Z"),
};

const DEFAULT_SUITE: TestSuiteEntry = {
  id: "suite_default",
  name: "Default",
  slug: "default",
  caseCount: 1,
};
const REFUNDS: TestSuiteEntry = {
  id: "suite_refunds",
  name: "Refunds",
  slug: "refunds",
  caseCount: 2,
};
const CHECKOUT: TestSuiteEntry = {
  id: "suite_checkout",
  name: "Checkout",
  slug: "checkout",
  caseCount: 1,
};

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: "case_1",
    name: "Double charge",
    labels: [],
    testSuiteId: REFUNDS.id,
    createdAt: new Date("2026-07-06T12:00:00.000Z"),
    lastUpdatedById: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<CaseLastResult> = {}): CaseLastResult {
  return {
    scenarioId: "case_1",
    status: ScenarioRunStatus.SUCCESS,
    metCriteriaCount: 3,
    unmetCriteriaCount: 0,
    lastRunAt: new Date("2026-07-08T09:30:00.000Z").getTime(),
    batchRunId: "batch_1",
    scenarioSetId: "__internal__suite_refunds__suite",
    durationInMs: null,
    totalCost: null,
    ...overrides,
  };
}

function panelProps(
  overrides: Partial<React.ComponentProps<typeof CasesPanel>> = {},
): React.ComponentProps<typeof CasesPanel> {
  return {
    selection: { kind: "suite", slug: "refunds" },
    title: "Refunds",
    cases: [],
    externalCases: [],
    isLoading: false,
    // A scenario with a run inside the period, which is what offers the recent
    // runs control under the table.
    lastResults: new Map([["case_1", makeResult()]]),
    isLastResultsLoading: false,
    suites: [REFUNDS, CHECKOUT],
    canManage: true,
    suite: REFUNDS,
    suiteScenarioIds: ["case_1"],
    period: PERIOD,
    hasAgent: true,
    projectHasNoCases: false,
    allLabels: [],
    activeLabels: [],
    onToggleLabel: vi.fn(),
    onRunSet: vi.fn(),
    onNewTestCase: vi.fn(),
    onNewSuite: vi.fn(),
    onConnectAgent: vi.fn(),
    onRowClick: vi.fn(),
    onRunCase: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveToSuite: vi.fn(),
    onArchive: vi.fn(),
    onOpenExternalCase: vi.fn(),
    onRenameSuite: vi.fn(),
    ...overrides,
  };
}

/**
 * Far enough back that the reading of "now" the page took when it loaded is
 * still two whole hours after it, however long the test itself takes.
 */
const TWO_HOURS_AGO = Date.now() - 2 * 60 * 60 * 1000 - 60_000;

function makeSuiteRun(
  overrides: Partial<ScenarioRunData> = {},
): ScenarioRunData {
  return {
    scenarioId: "case_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Double charge",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: null,
    messages: [],
    timestamp: TWO_HOURS_AGO,
    durationInMs: 6300,
    totalCost: 0.0042,
    ...overrides,
  } as ScenarioRunData;
}

/**
 * Three batches, handed over oldest first on purpose. Putting them in order
 * is the work the list does, so a fixture already in order would prove
 * nothing. batch_1 holds one run that passed and one that failed.
 */
function threeRuns(): ScenarioRunData[] {
  const day = 24 * 60 * 60 * 1000;
  return [
    makeSuiteRun({
      batchRunId: "batch_1",
      scenarioRunId: "run_1a",
      timestamp: TWO_HOURS_AGO - 2 * day,
    }),
    makeSuiteRun({
      batchRunId: "batch_1",
      scenarioRunId: "run_1b",
      status: ScenarioRunStatus.FAILED,
      timestamp: TWO_HOURS_AGO - 2 * day,
    }),
    makeSuiteRun({
      batchRunId: "batch_2",
      scenarioRunId: "run_2",
      timestamp: TWO_HOURS_AGO - day,
    }),
    makeSuiteRun({
      batchRunId: "batch_3",
      scenarioRunId: "run_3",
      timestamp: TWO_HOURS_AGO,
    }),
  ];
}

/**
 * The run plans of the project: the one named after the suite, and the one a
 * run of a single scenario made for itself.
 */
const RUN_PLANS = [
  { id: REFUNDS.id, name: REFUNDS.name, slug: REFUNDS.slug },
  {
    id: "suite_double_charge",
    name: "Double charge ACME Support Agent",
    slug: "double-charge-acme-support-agent",
  },
];

/** The set a run of the plan named after the suite carries. */
const REFUNDS_SET = "__internal__suite_refunds__suite";

/** The set a run of one scenario carries: the plan it made for itself. */
const ONE_CASE_SET = "__internal__suite_double_charge__suite";

/**
 * Hands the reads their answer: the runs, and which set each batch came from.
 * A batch with no entry falls back to the plan named after the suite.
 */
function setRecentRuns(
  runs: ScenarioRunData[],
  scenarioSetIds: Record<string, string> = {},
) {
  const bySet: Record<string, string> = {};
  for (const run of runs) {
    bySet[run.batchRunId] = scenarioSetIds[run.batchRunId] ?? REFUNDS_SET;
  }
  suiteRunDataQuery.mockReturnValue({
    data: { runs, scenarioSetIds: bySet },
    isLoading: false,
  });
}

async function openRecentRuns(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("recent-runs-trigger"));
  return await screen.findByTestId("recent-runs-list");
}

/** The pieces of text one row of the recent runs list is made of. */
function readRow(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll("p")).map(
    (part) => part.textContent ?? "",
  );
}

/** True for a read that was actually asked for rather than held back. */
function isEnabledRead(call: unknown[]): boolean {
  return (call[1] as { enabled?: boolean } | undefined)?.enabled === true;
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof CasesPanel>> = {},
) {
  const props = panelProps(overrides);
  const view = render(<CasesPanel {...props} />, { wrapper: Wrapper });
  return { props, view };
}

async function openRowMenu(caseName: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Actions for ${caseName}` }),
  );
  return user;
}

/** The view model for one address, with a fixed suite list and scenario list. */
function renderView({
  selection,
  suites,
  cases,
}: {
  selection: AgentTestingSelection;
  suites: TestSuiteEntry[];
  cases: TestCase[];
}) {
  return renderHook(() =>
    useTestCasesView({
      selection,
      period: PERIOD,
      suites,
      cases,
    }),
  );
}

describe("the scenarios table", () => {
  afterEach(cleanup);

  beforeEach(() => {
    routerPush.mockClear();
    suiteRunDataQuery.mockReset();
    suitesGetAllQuery.mockReset();
    suiteRunDataQuery.mockReturnValue({ data: undefined, isLoading: false });
    suitesGetAllQuery.mockReturnValue({ data: RUN_PLANS });
  });

  // --- Which suite is open ---

  describe("given an address and a rail of suites", () => {
    const cases = [
      makeCase({ id: "case_default", testSuiteId: DEFAULT_SUITE.id }),
      makeCase({ id: "case_refunds", testSuiteId: REFUNDS.id }),
    ];
    const suites = [DEFAULT_SUITE, REFUNDS];

    /** @scenario "The table lists the scenarios of the suite the address names" */
    it("opens the suite the address names", () => {
      const { result } = renderView({
        selection: { kind: "suite", slug: "refunds" },
        suites,
        cases,
      });

      expect(result.current.selectedSuite).toEqual(REFUNDS);
      expect(result.current.cases.map((entry) => entry.id)).toEqual([
        "case_refunds",
      ]);
    });

    /** @scenario "An address that names no suite opens the first suite of the rail" */
    it("opens the first suite of the rail when the address names none", () => {
      const { result } = renderView({
        selection: { kind: "suite", slug: null },
        suites,
        cases,
      });

      expect(result.current.selectedSuite).toEqual(DEFAULT_SUITE);
      expect(result.current.cases.map((entry) => entry.id)).toEqual([
        "case_default",
      ]);
    });

    /** @scenario "An address naming a suite that does not exist opens the first suite" */
    /** @scenario "An address naming a suite that does not exist degrades to the first one" */
    it("degrades to the first suite when the address names one that is gone", () => {
      const { result } = renderView({
        selection: { kind: "suite", slug: "archived-last-week" },
        suites,
        cases,
      });

      expect(result.current.selectedSuite).toEqual(DEFAULT_SUITE);
    });

    /** @scenario "Archiving the open suite opens the first suite that is left" */
    it("opens the first suite that is left when the open one is archived", () => {
      const { result, rerender } = renderHook(
        (props: { suites: TestSuiteEntry[] }) =>
          useTestCasesView({
            selection: { kind: "suite", slug: "refunds" },
            period: {
              startDate: new Date("2026-07-01T00:00:00.000Z"),
              endDate: new Date("2026-07-31T00:00:00.000Z"),
            },
            suites: props.suites,
            cases,
          }),
        { initialProps: { suites } },
      );

      expect(result.current.selectedSuite).toEqual(REFUNDS);

      // The rail drops the archived suite while the address still names it.
      rerender({ suites: [DEFAULT_SUITE] });

      expect(result.current.selectedSuite).toEqual(DEFAULT_SUITE);
      expect(result.current.cases.map((entry) => entry.id)).toEqual([
        "case_default",
      ]);
    });

    it("holds no suite at all while the project has none", () => {
      const { result } = renderView({
        selection: { kind: "suite", slug: null },
        suites: [],
        cases: [],
      });

      expect(result.current.selectedSuite).toBeNull();
      expect(result.current.cases).toEqual([]);
    });
  });

  // --- Row content ---

  /** @scenario "A row reads the title, the labels, Run and the row menu, in that order" */
  it("reads the title, the labels, Run and the row menu, and no Edit button", () => {
    renderPanel({ cases: [makeCase({ labels: ["critical", "billing"] })] });

    const row = screen.getByTestId("case-row-Double charge");
    expect(within(row).getByText("Double charge")).toBeInTheDocument();
    expect(within(row).getByTestId("tag-pill-critical")).toBeInTheDocument();
    expect(within(row).getByTestId("tag-pill-billing")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Run Double charge" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Actions for Double charge" }),
    ).toBeInTheDocument();
    // Edit is in the row menu and on the row click, never a third control.
    expect(
      within(row).queryByRole("button", { name: "Edit Double charge" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A row carries no leading file icon" */
  it("draws no file icon at the leading edge of a scenario row", () => {
    renderPanel({ cases: [makeCase()] });

    const row = screen.getByTestId("case-row-Double charge");
    expect(row.querySelector("svg.lucide-file-check-corner")).toBeNull();
  });

  /** @scenario "Labels are shown as small pastel pills beside the name" */
  it("shows the labels as pastel pills beside the name", () => {
    renderPanel({ cases: [makeCase({ labels: ["critical", "billing"] })] });

    const row = screen.getByTestId("case-row-Double charge");
    const critical = within(row).getByTestId("tag-pill-critical");
    const billing = within(row).getByTestId("tag-pill-billing");
    // Quieter than the name: the pill palette is a subtle surface, not the
    // foreground the scenario name is drawn in.
    expect(critical.className).not.toEqual(billing.className);
  });

  /** @scenario "The scenarios table shows the scenario column and the row actions, and no last result" */
  it("has no LAST RESULT column header and no per-row result cell", () => {
    renderPanel({
      cases: [makeCase()],
      lastResults: new Map([
        ["case_1", makeResult({ durationInMs: 6300, totalCost: 0.0042 })],
      ]),
    });

    const table = screen.getByTestId("agent-testing-cases-table");
    expect(within(table).queryByText(/last result/i)).not.toBeInTheDocument();
    expect(within(table).queryByText("Passed (3/3)")).not.toBeInTheDocument();
    expect(
      within(table).queryByTestId("case-row-Double charge-last-result"),
    ).not.toBeInTheDocument();
  });

  it("draws no test suite row, because the rail is the only list of suites", () => {
    renderPanel({ cases: [makeCase()] });

    expect(
      document.querySelector('[data-testid^="test-suite-header-row-"]'),
    ).toBeNull();
  });

  // --- Row actions ---

  /** @scenario "Every row carries an outlined Run button with the word Run" */
  it("carries an outlined Run button on every row", () => {
    renderPanel({ cases: [makeCase()] });

    const runButton = screen.getByRole("button", { name: "Run Double charge" });
    expect(runButton).toHaveTextContent("Run");
    expect(runButton.querySelector("svg.lucide-play")).toBeInTheDocument();
  });

  /** @scenario "The row menu offers Edit, Duplicate, Open recent runs, Move to suite... and Archive in order" */
  it("offers Edit, Duplicate, Open recent runs, Move to suite... and Archive in order", async () => {
    renderPanel({
      cases: [makeCase()],
      lastResults: new Map([["case_1", makeResult()]]),
    });
    await openRowMenu("Double charge");

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "Edit",
      "Duplicate",
      "Open recent runs",
      "Move to suite...",
      "Archive",
    ]);
  });

  /** @scenario "Every action of the row menu carries its icon" */
  it("carries an icon on every action of the row menu", async () => {
    renderPanel({
      cases: [makeCase()],
      lastResults: new Map([["case_1", makeResult()]]),
    });
    await openRowMenu("Double charge");

    const items = await screen.findAllByRole("menuitem");
    const icons = items.map((item) =>
      item.querySelector("svg")?.getAttribute("class"),
    );

    expect(icons).toEqual([
      expect.stringContaining("lucide-pencil"),
      expect.stringContaining("lucide-copy"),
      expect.stringContaining("lucide-list-checks"),
      expect.stringContaining("lucide-folder-input"),
      expect.stringContaining("lucide-archive"),
    ]);
  });

  /** @scenario "Open recent runs is not offered for a scenario that never ran" */
  it("does not offer Open recent runs for a scenario that never ran", async () => {
    renderPanel({ cases: [makeCase()], lastResults: new Map() });
    await openRowMenu("Double charge");

    expect(
      await screen.findByRole("menuitem", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Open recent runs" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Duplicate creates a copy in the same suite" */
  /** @scenario "Duplicating a scenario copies its suite" */
  it("puts the copy of a duplicated scenario in the same suite", async () => {
    const original = makeCase({ labels: ["critical"] });
    const { props, view } = renderPanel({ cases: [original] });
    const user = await openRowMenu("Double charge");

    await user.click(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    );
    expect(props.onDuplicate).toHaveBeenCalledWith(original);

    // The copy comes back from the server filed in the same suite.
    const copy = makeCase({
      id: "case_copy",
      name: "Double charge (copy)",
      labels: ["critical"],
    });
    view.rerender(<CasesPanel {...props} cases={[original, copy]} />);

    const copyRow = screen.getByTestId("case-row-Double charge (copy)");
    expect(
      within(copyRow).getByTestId("tag-pill-critical"),
    ).toBeInTheDocument();
  });

  /** @scenario "Move to suite... on a row starts checkbox selection with that row pre-checked" */
  it("starts checkbox selection with the clicked row pre-checked from the row menu", async () => {
    renderPanel({ cases: [makeCase()] });
    const user = await openRowMenu("Double charge");

    await user.click(
      await screen.findByRole("menuitem", { name: "Move to suite..." }),
    );

    expect(screen.getByTestId("cases-selection-action-bar")).toHaveTextContent(
      "1 selected",
    );
    expect(
      screen.getByTestId("case-row-Double charge-checkbox"),
    ).toBeInTheDocument();
  });

  /** @scenario "Move to suite... confirms a bulk move to another suite" */
  it("moves the selection to another suite from the action bar", async () => {
    const filed = makeCase();
    const { props } = renderPanel({ cases: [filed] });
    const user = await openRowMenu("Double charge");

    await user.click(
      await screen.findByRole("menuitem", { name: "Move to suite..." }),
    );
    await user.click(screen.getByTestId("cases-selection-move-to-suite"));

    const select = await screen.findByTestId("cases-move-to-suite-select");
    await user.selectOptions(select, CHECKOUT.id);
    await user.click(screen.getByTestId("cases-move-to-suite-confirm"));

    expect(props.onMoveToSuite).toHaveBeenCalledWith(filed, CHECKOUT.id);
  });

  /** @scenario "The move dialog offers only real test suites" */
  it("offers only real test suites as move targets", async () => {
    renderPanel({ cases: [makeCase()] });
    const user = await openRowMenu("Double charge");

    await user.click(
      await screen.findByRole("menuitem", { name: "Move to suite..." }),
    );
    await user.click(screen.getByTestId("cases-selection-move-to-suite"));

    const select = await screen.findByTestId("cases-move-to-suite-select");
    const options = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["Refunds", "Checkout"]);
    // Every scenario sits in a suite, so there is nothing to unfile it to.
    expect(options).not.toContain("No test suite");
  });

  // --- Row click ---

  /** @scenario "Clicking a row opens the scenario editor" */
  it("opens the scenario editor when the row is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({
      cases: [testCase],
      lastResults: new Map([["case_1", makeResult()]]),
    });

    await user.click(screen.getByText("Double charge"));

    expect(props.onRowClick).toHaveBeenCalledWith(testCase);
  });

  /** @scenario "Clicking a row with no last run opens the scenario editor" */
  it("opens the scenario editor when a row with no last run is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({
      cases: [testCase],
      lastResults: new Map(),
    });

    await user.click(screen.getByText("Double charge"));

    expect(props.onRowClick).toHaveBeenCalledWith(testCase);
  });

  /** @scenario "Clicking the Run button does not open the row" */
  it("hands the Run button to the run dialog and not to the row", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({
      cases: [makeCase()],
      lastResults: new Map([["case_1", makeResult()]]),
    });

    await user.click(screen.getByRole("button", { name: "Run Double charge" }));

    expect(props.onRunCase).toHaveBeenCalledWith(makeCase());
    expect(props.onRowClick).not.toHaveBeenCalled();
  });

  // --- Filtering ---

  /** @scenario "The label filter narrows the table to one label" */
  it("narrows the table to one label", async () => {
    const user = userEvent.setup();
    const critical = makeCase({ labels: ["critical"] });
    const billing = makeCase({
      id: "case_2",
      name: "Late refund",
      labels: ["billing"],
    });

    const { props, view } = renderPanel({
      cases: [critical, billing],
      allLabels: ["billing", "critical"],
    });

    await user.click(screen.getByRole("button", { name: /Labels/ }));
    const filter = await screen.findByRole("dialog");
    await user.click(within(filter).getByText("critical"));
    expect(props.onToggleLabel).toHaveBeenCalledWith("critical");

    view.rerender(
      <CasesPanel {...props} activeLabels={["critical"]} cases={[critical]} />,
    );

    expect(screen.getByText("Double charge")).toBeInTheDocument();
    expect(screen.queryByText("Late refund")).not.toBeInTheDocument();
  });

  // --- Renaming the open suite ---

  describe("given the suite Refunds is open", () => {
    /** @scenario "The name of the open suite carries a rename control" */
    it("offers a rename control beside the name that opens the name dialog", async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ cases: [makeCase()] });

      const rename = screen.getByRole("button", { name: "Rename test suite" });
      // It sits with the name, not among the actions at the far end of the line.
      expect(rename.parentElement).toHaveTextContent("Refunds");

      await user.click(rename);
      expect(props.onRenameSuite).toHaveBeenCalled();
    });

    /** @scenario "The rename control is reachable from the keyboard" */
    it("takes keyboard focus, so it is not offered on hover alone", () => {
      renderPanel({ cases: [makeCase()] });

      const rename = screen.getByRole("button", { name: "Rename test suite" });
      rename.focus();

      expect(document.activeElement).toBe(rename);
      expect(rename).not.toHaveAttribute("tabindex", "-1");
      expect(rename).not.toHaveAttribute("aria-hidden");
    });

    /** @scenario "No Edit suite button sits above the table" */
    it("offers no Edit suite button above the table", () => {
      renderPanel({ cases: [makeCase()] });

      expect(screen.queryByText("Edit suite")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit suite" }),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A person with read-only access is offered no rename control" */
    it("offers no rename control to a person with read-only access", () => {
      renderPanel({ cases: [makeCase()], canManage: false });

      expect(screen.getByText("Refunds")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Rename test suite" }),
      ).not.toBeInTheDocument();
    });
  });

  // --- Recent runs ---

  describe("given a test suite whose scenarios ran in the period", () => {
    /** @scenario "One button above the table opens a recent run of the suite" */
    it("offers one Open recent run button and no last run line", () => {
      renderPanel({ cases: [makeCase()] });

      expect(
        screen.getByRole("button", { name: /Open recent run/ }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Last run on/)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("cases-last-run-line"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "One button above the table opens a recent run of the suite" */
    it("sits in the header between New scenario and Run suite", () => {
      renderPanel({ cases: [makeCase()] });

      const header = screen.getByTestId("recent-runs-trigger").parentElement;
      // The rename control beside the suite name carries an icon and no words.
      const labels = Array.from(header?.querySelectorAll("button") ?? [])
        .map((button) => button.textContent)
        .filter((label) => !!label);

      expect(labels).toEqual(["New scenario", "Open recent run", "Run suite"]);
    });

    /** @scenario "A run of one scenario of the suite is offered above the table" */
    /** @scenario "The submenu holds a run of a suite whose scenarios ran one at a time" */
    it("offers a run that a scenario of the suite made its own plan for", async () => {
      setRecentRuns([makeSuiteRun({ batchRunId: "batch_alone" })], {
        batch_alone: ONE_CASE_SET,
      });
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });

      const list = await openRecentRuns(user);
      const row = within(list).getByTestId("recent-run-batch_alone");

      expect(row).toHaveTextContent("Double charge ACME Support Agent");
    });

    /** @scenario "The list names the recent runs of that suite, newest first" */
    it("lists the runs newest first with the plan, the time and the result", async () => {
      setRecentRuns(threeRuns());
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });

      const list = await openRecentRuns(user);
      const rows = within(list).getAllByRole("menuitem");

      expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
        "recent-run-batch_3",
        "recent-run-batch_2",
        "recent-run-batch_1",
      ]);
      expect(rows[0]).toHaveTextContent("Refunds");
      expect(rows[0]).toHaveTextContent("2h ago");
      expect(rows[0]).toHaveTextContent("100%");
      // batch_1 held one passed run and one failed one.
      expect(rows[2]).toHaveTextContent("50%");
    });

    /** @scenario "A run that covered no scenario of the suite is left out" */
    it("leaves out a run that covered no scenario of the suite", async () => {
      setRecentRuns([
        ...threeRuns(),
        makeSuiteRun({
          batchRunId: "batch_elsewhere",
          scenarioRunId: "run_elsewhere",
          scenarioId: "case_elsewhere",
        }),
      ]);
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });

      const list = await openRecentRuns(user);

      expect(
        within(list).queryByTestId("recent-run-batch_elsewhere"),
      ).not.toBeInTheDocument();
      expect(within(list).getAllByRole("menuitem")).toHaveLength(3);
    });

    /** @scenario "A run that belongs to no run plan is left out" */
    it("leaves out a run of a set the platform keeps for itself", async () => {
      setRecentRuns(
        [
          ...threeRuns(),
          makeSuiteRun({
            batchRunId: "batch_reserved",
            scenarioRunId: "run_reserved",
          }),
        ],
        { batch_reserved: "__internal__proj_1__on-platform-scenarios" },
      );
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });

      const list = await openRecentRuns(user);

      expect(
        within(list).queryByTestId("recent-run-batch_reserved"),
      ).not.toBeInTheDocument();
      expect(list).not.toHaveTextContent("__internal__");
    });

    /** @scenario "A row of the list stays short" */
    it("holds only the run plan, the time and the pass rate in a row", async () => {
      setRecentRuns(threeRuns());
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });

      const list = await openRecentRuns(user);
      const row = within(list).getByTestId("recent-run-batch_3");

      expect(readRow(row)).toEqual(["Refunds", "2h ago", "100%"]);
    });

    /** @scenario "A run that is still going reads as running" */
    it("reads running in place of a pass rate while a run is still judged", async () => {
      setRecentRuns([
        makeSuiteRun({
          batchRunId: "batch_live",
          scenarioRunId: "run_live",
          status: ScenarioRunStatus.IN_PROGRESS,
        }),
      ]);
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });

      const list = await openRecentRuns(user);

      expect(
        readRow(within(list).getByTestId("recent-run-batch_live")),
      ).toEqual(["Refunds", "2h ago", "running"]);
    });

    /** @scenario "Choosing a run opens it on the Results tab" */
    it("pushes the Results tab, the plan the run belongs to and that run", async () => {
      setRecentRuns(threeRuns(), { batch_2: ONE_CASE_SET });
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });

      const list = await openRecentRuns(user);
      await user.click(within(list).getByTestId("recent-run-batch_2"));

      expect(routerPush).toHaveBeenCalledWith(
        {
          pathname: "/[project]/agent-testing/[[...path]]",
          query: {
            project: "test-project",
            path: ["results", "double-charge-acme-support-agent", "batch_2"],
          },
        },
        "/test-project/agent-testing/results/double-charge-acme-support-agent/batch_2",
        { shallow: true },
      );
    });

    /** @scenario "The runs are read only when the list is opened" */
    it("holds both reads back until the list is opened", async () => {
      setRecentRuns(threeRuns());

      // The hook itself holds the reads back, whether or not the list is
      // mounted while it is closed.
      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useSuiteRecentRuns({
            scenarioIds: ["case_1"],
            period: PERIOD,
            enabled,
          }),
        { initialProps: { enabled: false } },
      );

      expect(suiteRunDataQuery.mock.calls.some(isEnabledRead)).toBe(false);
      expect(suitesGetAllQuery.mock.calls.some(isEnabledRead)).toBe(false);

      rerender({ enabled: true });

      expect(suiteRunDataQuery.mock.calls.some(isEnabledRead)).toBe(true);
      expect(suitesGetAllQuery.mock.calls.some(isEnabledRead)).toBe(true);

      // And opening the list is what turns them on.
      suiteRunDataQuery.mockClear();
      suitesGetAllQuery.mockClear();
      setRecentRuns(threeRuns());
      const user = userEvent.setup();
      renderPanel({ cases: [makeCase()] });
      await openRecentRuns(user);

      expect(suiteRunDataQuery.mock.calls.some(isEnabledRead)).toBe(true);
      expect(suitesGetAllQuery.mock.calls.some(isEnabledRead)).toBe(true);
    });
  });

  describe("when the recent runs hang off a row menu", () => {
    /** @scenario "Open recent runs holds the runs of that scenario" */
    it("lists the runs of that scenario and opens one under its plan", async () => {
      setRecentRuns(threeRuns());
      renderPanel({
        cases: [makeCase()],
        lastResults: new Map([["case_1", makeResult()]]),
      });
      const user = await openRowMenu("Double charge");

      await user.click(
        await screen.findByRole("menuitem", { name: /Open recent runs/ }),
      );

      const list = await screen.findByTestId("recent-runs-submenu-list");
      const rows = within(list).getAllByTestId(/^recent-run-/);
      expect(rows).toHaveLength(3);

      await user.click(rows[0]!);

      // The row opens the run under the plan that holds it, the way the button
      // above the table does, rather than in the single run drawer.
      expect(routerPush).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: "/[project]/agent-testing/[[...path]]",
        }),
        expect.stringContaining("/results/"),
        { shallow: true },
      );
    });

    /** @scenario "The runs of a row are read only when its submenu is opened" */
    it("reads nothing while the submenu stays closed", async () => {
      setRecentRuns(threeRuns());
      renderPanel({
        cases: [makeCase()],
        lastResults: new Map([["case_1", makeResult()]]),
      });
      suiteRunDataQuery.mockClear();
      suitesGetAllQuery.mockClear();

      const user = await openRowMenu("Double charge");
      await screen.findByRole("menuitem", { name: /Open recent runs/ });

      expect(suiteRunDataQuery.mock.calls.some(isEnabledRead)).toBe(false);

      await user.click(
        screen.getByRole("menuitem", { name: /Open recent runs/ }),
      );
      await screen.findByTestId("recent-runs-submenu-list");

      expect(suiteRunDataQuery.mock.calls.some(isEnabledRead)).toBe(true);
    });
  });

  /** @scenario "A suite whose scenarios have no run in the period offers no recent runs button" */
  it("offers no recent runs button when no scenario of the suite ran", () => {
    renderPanel({ cases: [makeCase()], lastResults: new Map() });

    expect(screen.queryByTestId("recent-runs-trigger")).not.toBeInTheDocument();
    expect(screen.queryByText("Open recent run")).not.toBeInTheDocument();
  });

  // --- Empty states ---

  /** @scenario "An open suite that holds no scenario says what to do" */
  it("offers to add or move a scenario when the open suite is empty", () => {
    renderPanel({ cases: [], projectHasNoCases: false });

    expect(screen.getByTestId("agent-testing-empty-suite")).toHaveTextContent(
      "Empty suite. Add a scenario, or move one here from another suite.",
    );
  });

  /** @scenario "A project with no scenario at all explains what a scenario is" */
  /** @scenario "A project with no scenarios shows what to do first" */
  it("explains what a scenario is when the project holds none at all", () => {
    renderPanel({ cases: [], projectHasNoCases: true });

    const empty = screen.getByTestId("agent-testing-first-case-empty");
    expect(
      within(empty).getByText("Write your first scenario"),
    ).toBeInTheDocument();
    expect(
      within(empty).getByRole("button", { name: "New scenario" }),
    ).toBeInTheDocument();
  });

  // --- Day zero ---

  describe("given a brand new project", () => {
    /** @scenario "A brand new project is asked to name its first test suite" */
    it("asks for the name of the first test suite and shows no suite header", async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({
        suite: null,
        hasAgent: true,
        projectHasNoCases: true,
        suites: [],
        cases: [],
        title: "",
      });

      const empty = screen.getByTestId("agent-testing-first-suite-empty");
      expect(
        within(empty).getByText("Name your first test suite"),
      ).toBeInTheDocument();
      // No suite is open, so no empty suite view is drawn beside it.
      expect(
        screen.queryByTestId("agent-testing-empty-suite"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-testing-cases-table"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Run suite")).not.toBeInTheDocument();
      // Default is made for older projects by migration, never offered here.
      expect(screen.queryByText("Default")).not.toBeInTheDocument();

      await user.click(
        within(empty).getByRole("button", { name: "New test suite" }),
      );
      expect(props.onNewSuite).toHaveBeenCalled();
    });

    /** @scenario "A project with no agent is asked to connect one first" */
    it("offers to connect the agent before it asks for a test suite", async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({
        suite: null,
        hasAgent: false,
        projectHasNoCases: true,
        suites: [],
        cases: [],
        title: "",
      });

      const empty = screen.getByTestId("agent-testing-connect-agent-empty");
      expect(empty).toHaveTextContent("Connect the agent you want to test");
      expect(
        screen.queryByTestId("agent-testing-first-suite-empty"),
      ).not.toBeInTheDocument();

      await user.click(
        within(empty).getByRole("button", { name: "Setup agent" }),
      );
      expect(props.onConnectAgent).toHaveBeenCalled();
    });

    it("holds the skeleton rather than asking anything while the reads are open", () => {
      renderPanel({
        isLoading: true,
        suite: null,
        hasAgent: false,
        suites: [],
        cases: [],
      });

      expect(
        screen.getByTestId("agent-testing-cases-skeleton"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-testing-connect-agent-empty"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-testing-first-suite-empty"),
      ).not.toBeInTheDocument();
    });
  });

  // --- External sets ---

  /** @scenario "An external set lists its scenarios read-only with a last run column" */
  it("lists the scenarios of an external set read-only", () => {
    renderPanel({
      selection: { kind: "external", setId: "nightly-ci" },
      title: "nightly-ci",
      externalCases: [
        {
          scenarioId: "s1",
          name: "Refund flow",
          lastRunAt: new Date("2026-07-08T09:30:00.000Z").getTime(),
        },
        {
          scenarioId: "s2",
          name: "Checkout flow",
          lastRunAt: new Date("2026-07-08T09:00:00.000Z").getTime(),
        },
      ],
    });

    expect(screen.getByText("Refund flow")).toBeInTheDocument();
    expect(screen.getByText("Checkout flow")).toBeInTheDocument();
    expect(screen.getByText("Last run")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Run / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Actions for/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("from code")).toBeInTheDocument();
  });

  /** @scenario "Clicking a row of an external set opens its results" */
  it("opens the results of an external set row and no editor", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({
      selection: { kind: "external", setId: "nightly-ci" },
      title: "nightly-ci",
      externalCases: [
        {
          scenarioId: "s1",
          name: "Refund flow",
          lastRunAt: new Date("2026-07-08T09:30:00.000Z").getTime(),
        },
      ],
    });

    await user.click(screen.getByText("Refund flow"));

    expect(props.onOpenExternalCase).toHaveBeenCalledWith("s1");
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  /** @scenario "A set that runs from code offers Open recent run and no View results" */
  it("offers Open recent run and no View results on a set that runs from code", () => {
    renderPanel({
      selection: { kind: "external", setId: "nightly-ci" },
      title: "nightly-ci",
      externalCases: [
        {
          scenarioId: "s1",
          name: "Refund flow",
          lastRunAt: new Date("2026-07-08T09:30:00.000Z").getTime(),
        },
      ],
    });

    expect(screen.getByTestId("recent-runs-trigger")).toBeInTheDocument();
    expect(screen.queryByText("View results")).not.toBeInTheDocument();
  });
});
