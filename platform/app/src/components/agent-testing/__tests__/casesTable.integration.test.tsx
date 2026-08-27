/**
 * @vitest-environment jsdom
 *
 * The table of scenarios of the open suite: which suite that is, what a row
 * says, and what its Run button and row menu do.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { CasesPanel } from "../cases/CasesPanel";
import type { CaseLastResult } from "../cases/CasesTable";
import type { TestCase, TestSuiteEntry } from "../cases/test-cases";
import { useTestCasesView } from "../cases/useTestCasesView";
import type { AgentTestingSelection } from "../useAgentTestingRouting";

vi.mock("~/utils/api", () => ({
  api: {
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    scenarios: {
      getScenarioSetRunData: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    projectId: "proj_1",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), isReady: true }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
    folderId: REFUNDS.id,
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
    lastResults: new Map(),
    isLastResultsLoading: false,
    suites: [REFUNDS, CHECKOUT],
    canManage: true,
    hasSuite: true,
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
    onHistory: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveToSuite: vi.fn(),
    onOpenLastRun: vi.fn(),
    onArchive: vi.fn(),
    onOpenExternalCase: vi.fn(),
    onOpenExternalResults: vi.fn(),
    onEditSuite: vi.fn(),
    ...overrides,
  };
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

/** The view model for one address, with a fixed suite list and case list. */
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
      period: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-31T00:00:00.000Z"),
      },
      suites,
      cases,
    }),
  );
}

describe("the scenarios table", () => {
  afterEach(cleanup);

  // --- Which suite is open ---

  describe("given an address and a rail of suites", () => {
    const cases = [
      makeCase({ id: "case_default", folderId: DEFAULT_SUITE.id }),
      makeCase({ id: "case_refunds", folderId: REFUNDS.id }),
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
  it("draws no file icon at the leading edge of a case row", () => {
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
    // foreground the case name is drawn in.
    expect(critical.className).not.toEqual(billing.className);
  });

  /** @scenario "The cases table shows the scenario column and the row actions, and no last result" */
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

  it("draws no folder row, because the rail is the only list of suites", () => {
    renderPanel({ cases: [makeCase()] });

    expect(
      document.querySelector('[data-testid^="folder-header-row-"]'),
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

  /** @scenario "The row menu offers Edit, Duplicate, Open last run, Move to suite..., History and Archive in order" */
  it("offers Edit, Duplicate, Open last run, Move to suite..., History and Archive in order", async () => {
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
      "Open last run",
      "Move to suite...",
      "History",
      "Archive",
    ]);
  });

  /** @scenario "Open last run is not offered for a case that never ran" */
  it("does not offer Open last run for a case that never ran", async () => {
    renderPanel({ cases: [makeCase()], lastResults: new Map() });
    await openRowMenu("Double charge");

    expect(
      await screen.findByRole("menuitem", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Open last run" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Duplicate creates a copy in the same suite" */
  /** @scenario "Duplicating a case copies its suite" */
  it("puts the copy of a duplicated case in the same suite", async () => {
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

  /** @scenario "Clicking a row opens the case editor" */
  it("opens the case editor when the row is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({
      cases: [testCase],
      lastResults: new Map([["case_1", makeResult()]]),
    });

    await user.click(screen.getByText("Double charge"));

    expect(props.onRowClick).toHaveBeenCalledWith(testCase);
    expect(props.onOpenLastRun).not.toHaveBeenCalled();
  });

  /** @scenario "Clicking a row with no last run opens the case editor" */
  it("opens the case editor when a row with no last run is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({ cases: [testCase], lastResults: new Map() });

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

  // --- The summary line ---

  /** @scenario "A borderless line under the table says when the suite last ran" */
  it("says under the table when the suite last ran and how it did", () => {
    renderPanel({
      cases: [makeCase()],
      lastResults: new Map([["case_1", makeResult()]]),
    });

    const line = screen.getByTestId("cases-last-run-line");
    expect(line).toHaveTextContent("Last run on Jul 8");
    expect(within(line).getByText("100%")).toBeInTheDocument();
    // The date sits directly left of the result, with nothing pushing them
    // apart, so the pair reads at the right edge of the line.
    expect(line.children).toHaveLength(2);
    expect(line.children[0]).toHaveTextContent("Last run on");
    expect(line.children[1]).toHaveAttribute(
      "data-testid",
      "run-metrics-summary",
    );
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
        hasSuite: false,
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
        hasSuite: false,
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
        hasSuite: false,
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

  /** @scenario "An external set lists its cases read-only with a last run column" */
  it("lists the cases of an external set read-only", () => {
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
});
