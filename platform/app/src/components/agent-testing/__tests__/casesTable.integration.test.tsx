/**
 * @vitest-environment jsdom
 *
 * The table of test cases: how the rows group, what a row says, and what its
 * Run button and row menu do.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { CasesPanel } from "../cases/CasesPanel";
import type { CaseLastResult } from "../cases/CasesTable";
import {
  groupCasesByFolder,
  type TestCase,
  type TestSuiteEntry,
} from "../cases/test-cases";

vi.mock("~/utils/api", () => ({
  api: {
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
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
    selection: { kind: "all" },
    title: "All test cases",
    folderGroups: [],
    looseCases: [],
    externalCases: [],
    isLoading: false,
    lastResults: new Map(),
    isLastResultsLoading: false,
    suites: [REFUNDS, CHECKOUT],
    canManage: true,
    projectHasNoCases: false,
    allLabels: [],
    activeLabels: [],
    onToggleLabel: vi.fn(),
    onRunSet: vi.fn(),
    onNewTestCase: vi.fn(),
    onSelectSuite: vi.fn(),
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

/** The group headings the table drew, in reading order. */
function groupHeadings(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid^="folder-header-row-"]'),
  ).map((row) => row.getAttribute("data-testid") ?? "");
}

async function openRowMenu(caseName: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Actions for ${caseName}` }),
  );
  return user;
}

describe("the test cases table", () => {
  afterEach(cleanup);

  // --- Grouping ---

  /** @scenario "All test cases lists the test suites on top and the loose cases below" */
  /** @scenario "All test cases lists the loose cases below the folder rows" */
  it("lists the suites as folder rows on top and the loose cases below", () => {
    const cases = [
      makeCase(),
      makeCase({ id: "case_2", name: "Late refund" }),
      makeCase({
        id: "case_3",
        name: "Card declined",
        folderId: CHECKOUT.id,
      }),
      makeCase({ id: "case_4", name: "Stray one", folderId: null }),
      makeCase({ id: "case_5", name: "Stray two", folderId: null }),
      makeCase({ id: "case_6", name: "Stray three", folderId: null }),
    ];

    renderPanel({
      ...groupCasesByFolder({ cases, suites: [REFUNDS, CHECKOUT] }),
    });

    // Folders on top, in alphabetical order, with no expanded case rows.
    expect(groupHeadings()).toEqual([
      "folder-header-row-Checkout",
      "folder-header-row-Refunds",
    ]);
    expect(
      screen.queryByTestId("folder-header-row-No test suite"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("case-row-Double charge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("case-row-Card declined"),
    ).not.toBeInTheDocument();

    // Loose cases render as their own rows at the root, in the order given.
    const rowIds = Array.from(
      document.querySelectorAll('[data-testid^="case-row-"]'),
    ).map((row) => row.getAttribute("data-testid"));
    expect(rowIds).toEqual([
      "case-row-Stray one",
      "case-row-Stray two",
      "case-row-Stray three",
    ]);
  });

  /** @scenario "Clicking a suite folder row opens that suite" */
  it("navigates to the suite when its folder row is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({
      ...groupCasesByFolder({
        cases: [makeCase(), makeCase({ id: "case_2", name: "Late refund" })],
        suites: [REFUNDS, CHECKOUT],
      }),
    });

    await user.click(screen.getByTestId("folder-header-row-Refunds"));

    expect(props.onSelectSuite).toHaveBeenCalledWith(REFUNDS.id);
  });

  /** @scenario "The panel title reads Test suites when at least one suite exists" */
  it("reads Test suites in the panel header when at least one suite exists", () => {
    renderPanel({
      title: "Test suites",
      folderGroups: [],
      looseCases: [makeCase(), makeCase({ id: "case_2", folderId: null })],
    });

    expect(screen.getByText("Test suites")).toBeInTheDocument();
    expect(screen.getByText("2 cases")).toBeInTheDocument();
  });

  /** @scenario "Zero suites renders no folder rows and no Test suites section header" */
  it("renders only loose case rows and no Test suites header when zero suites", () => {
    renderPanel({
      title: "All test cases",
      ...groupCasesByFolder({
        cases: [makeCase({ folderId: null })],
        suites: [],
      }),
    });

    expect(
      document.querySelector('[data-testid^="folder-header-row-"]'),
    ).toBeNull();
    expect(screen.queryByText("Test suites")).not.toBeInTheDocument();
    expect(screen.getByTestId("case-row-Double charge")).toBeInTheDocument();
  });

  /** @scenario "A folder row carries the last result of the whole suite" */
  it("carries the pass summary of a whole suite on its heading", () => {
    const cases = [
      makeCase(),
      makeCase({ id: "case_2", name: "Late refund" }),
      makeCase({ id: "case_3", name: "Partial refund" }),
    ];
    const lastResults = new Map<string, CaseLastResult>(
      cases.map((testCase) => [
        testCase.id,
        makeResult({ scenarioId: testCase.id }),
      ]),
    );

    renderPanel({
      ...groupCasesByFolder({ cases, suites: [REFUNDS] }),
      lastResults,
    });

    const heading = screen.getByTestId("folder-header-row-Refunds");
    expect(within(heading).getByText("100%")).toBeInTheDocument();
    expect(within(heading).getByLabelText("3 test cases")).toBeInTheDocument();
  });

  /** @scenario "A single suite view lists its rows without group headings" */
  it("lists the rows of one suite with no group heading", () => {
    const cases = [
      makeCase(),
      makeCase({ id: "case_2", name: "Late refund" }),
      makeCase({ id: "case_3", name: "Partial refund" }),
    ];

    renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      folderGroups: [],
      looseCases: cases,
    });

    expect(
      screen.queryByTestId("folder-header-row-Refunds"),
    ).not.toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-testid^="case-row-"]'),
    ).toHaveLength(3);
  });

  // --- Row content ---

  /** @scenario "Labels are shown as small pastel pills beside the name" */
  it("shows the labels as pastel pills beside the name", () => {
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase({ labels: ["critical", "billing"] })],
      selection: { kind: "suite", slug: "refunds" },
    });

    const row = screen.getByTestId("case-row-Double charge");
    const critical = within(row).getByTestId("tag-pill-critical");
    const billing = within(row).getByTestId("tag-pill-billing");
    expect(critical).toBeInTheDocument();
    expect(billing).toBeInTheDocument();
    // Quieter than the name: the pill palette is a subtle surface, not the
    // foreground the case name is drawn in.
    expect(critical.className).not.toEqual(billing.className);
  });

  /** @scenario "The last result cell shows the verdict of the last run" */
  it("shows the verdict of the last run and the run metrics on hover", async () => {
    const user = userEvent.setup();
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
      lastResults: new Map([
        ["case_1", makeResult({ durationInMs: 6300, totalCost: 0.0042 })],
      ]),
    });

    expect(screen.getByText("Passed (3/3)")).toBeInTheDocument();

    await user.hover(screen.getByText("Passed (3/3)"));
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("6.3s · $0.004200")).toBeInTheDocument();
  });

  /** @scenario "A test case that never ran shows an empty last result" */
  it("leaves the last result empty for a case that never ran and still offers Run", () => {
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
      lastResults: new Map(),
    });

    const row = screen.getByTestId("case-row-Double charge");
    expect(within(row).getByTestId("last-result-empty")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Run Double charge" }),
    ).toBeInTheDocument();
  });

  /** @scenario "Under a single suite the time and cost read beside the last result" */
  it("reads the time and the cost beside the verdict under one suite", () => {
    renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      folderGroups: [],
      looseCases: [makeCase()],
      lastResults: new Map([
        ["case_1", makeResult({ durationInMs: 6300, totalCost: 0.0042 })],
      ]),
    });

    const row = screen.getByTestId("case-row-Double charge");
    expect(within(row).getByText("Passed (3/3)")).toBeInTheDocument();
    expect(within(row).getByText("6.3s · $0.004200")).toBeInTheDocument();
  });

  /** @scenario "The last result cells fill in after the table is drawn" */
  it("draws the rows first and fills the last result cells in after", () => {
    const cases = [
      makeCase(),
      makeCase({ id: "case_2", name: "Late refund" }),
      makeCase({ id: "case_3", name: "Partial refund" }),
    ];
    const { props, view } = renderPanel({
      folderGroups: [],
      looseCases: cases,
      lastResults: new Map(),
      isLastResultsLoading: true,
    });

    expect(screen.getByText("Double charge")).toBeInTheDocument();
    expect(screen.getByText("Partial refund")).toBeInTheDocument();
    expect(screen.queryByText("Passed (3/3)")).not.toBeInTheDocument();

    view.rerender(
      <CasesPanel
        {...props}
        isLastResultsLoading={false}
        lastResults={
          new Map(
            cases.map((testCase) => [
              testCase.id,
              makeResult({ scenarioId: testCase.id }),
            ]),
          )
        }
      />,
    );

    expect(screen.getAllByText("Passed (3/3)")).toHaveLength(3);
  });

  // --- Row actions ---

  /** @scenario "Every row carries an outlined Run button with the word Run" */
  it("carries an outlined Run button on every row", () => {
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
    });

    const runButton = screen.getByRole("button", { name: "Run Double charge" });
    expect(runButton).toHaveTextContent("Run");
    expect(runButton.querySelector("svg.lucide-play")).toBeInTheDocument();
  });

  /** @scenario "The row menu offers Edit, Duplicate, Open last run, Move to suite..., History and Archive in order" */
  it("offers Edit, Duplicate, Open last run, Move to suite..., History and Archive in order", async () => {
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
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
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
      lastResults: new Map(),
    });
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
    const { props, view } = renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      folderGroups: [],
      looseCases: [original],
    });
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
    view.rerender(
      <CasesPanel {...props} folderGroups={[]} looseCases={[original, copy]} />,
    );

    const copyRow = screen.getByTestId("case-row-Double charge (copy)");
    expect(
      within(copyRow).getByTestId("tag-pill-critical"),
    ).toBeInTheDocument();
  });

  /** @scenario "Move to suite... on a row starts checkbox selection with that row pre-checked" */
  it("starts checkbox selection with the clicked row pre-checked from the row menu", async () => {
    const filed = makeCase();
    renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      folderGroups: [],
      looseCases: [filed],
    });
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
    const { props } = renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      folderGroups: [],
      looseCases: [filed],
    });
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

  /** @scenario "Move to suite... unfiles when 'No test suite' is picked" */
  it("unfiles the selection when No test suite is picked in the dialog", async () => {
    const filed = makeCase();
    const { props } = renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      folderGroups: [],
      looseCases: [filed],
    });
    const user = await openRowMenu("Double charge");

    await user.click(
      await screen.findByRole("menuitem", { name: "Move to suite..." }),
    );
    await user.click(screen.getByTestId("cases-selection-move-to-suite"));
    await user.click(screen.getByTestId("cases-move-to-suite-confirm"));

    expect(props.onMoveToSuite).toHaveBeenCalledWith(filed, null);
  });

  // --- Row click ---

  /** @scenario "Clicking a row opens the case editor" */
  it("opens the case editor when the row is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({
      folderGroups: [],
      looseCases: [testCase],
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
    const { props } = renderPanel({
      folderGroups: [],
      looseCases: [testCase],
      lastResults: new Map(),
    });

    await user.click(screen.getByText("Double charge"));

    expect(props.onRowClick).toHaveBeenCalledWith(testCase);
  });

  /** @scenario "Clicking the last result cell opens the last run" */
  it("opens the last run when the last result ghost button is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({
      folderGroups: [],
      looseCases: [testCase],
      lastResults: new Map([["case_1", makeResult()]]),
    });

    const cell = screen.getByRole("button", {
      name: "Open the last run of Double charge",
    });
    await user.click(cell);

    expect(props.onOpenLastRun).toHaveBeenCalledWith(testCase);
    expect(props.onRowClick).not.toHaveBeenCalled();
  });

  /** @scenario "The last result cell has no button when there is no last run" */
  it("renders the last result cell without a button when there is no last run", () => {
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
      lastResults: new Map(),
    });

    expect(
      screen.queryByRole("button", {
        name: "Open the last run of Double charge",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("last-result-empty")).toBeInTheDocument();
  });

  /** @scenario "Clicking the Run button does not open the row" */
  it("hands the Run button to the run dialog and not to the row", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
      lastResults: new Map([["case_1", makeResult()]]),
    });

    await user.click(screen.getByRole("button", { name: "Run Double charge" }));

    expect(props.onRunCase).toHaveBeenCalledWith(makeCase());
    expect(props.onRowClick).not.toHaveBeenCalled();
  });

  // --- Filtering ---

  /** @scenario "The label filter narrows the table to one label" */
  it("narrows the table to one label and hides the folder rows it empties", async () => {
    const user = userEvent.setup();
    // One loose case and two filed cases, one per suite.
    const critical = makeCase({ labels: ["critical"], folderId: null });
    const billing = makeCase({
      id: "case_2",
      name: "Late refund",
      labels: ["billing"],
    });
    const edge = makeCase({
      id: "case_3",
      name: "Card declined",
      labels: ["edge"],
      folderId: CHECKOUT.id,
    });

    const { props, view } = renderPanel({
      ...groupCasesByFolder({
        cases: [critical, billing, edge],
        suites: [REFUNDS, CHECKOUT],
      }),
      allLabels: ["billing", "critical", "edge"],
    });

    await user.click(screen.getByRole("button", { name: /Labels/ }));
    const filter = await screen.findByRole("dialog");
    await user.click(within(filter).getByText("critical"));
    expect(props.onToggleLabel).toHaveBeenCalledWith("critical");

    view.rerender(
      <CasesPanel
        {...props}
        activeLabels={["critical"]}
        {...groupCasesByFolder({
          cases: [critical],
          suites: [REFUNDS, CHECKOUT],
        })}
      />,
    );

    expect(screen.getByText("Double charge")).toBeInTheDocument();
    expect(screen.queryByText("Late refund")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("folder-header-row-Checkout"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("folder-header-row-Refunds"),
    ).not.toBeInTheDocument();
  });

  // --- The summary line ---

  /** @scenario "A borderless line under the table says when the set last ran" */
  it("says under the table when a suite last ran and how it did", () => {
    renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      folderGroups: [],
      looseCases: [makeCase()],
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

  /** @scenario "All test cases reads Last full run at" */
  it("reads Last full run at in the All test cases view", () => {
    renderPanel({
      folderGroups: [],
      looseCases: [makeCase()],
      lastResults: new Map([["case_1", makeResult()]]),
    });

    expect(screen.getByTestId("cases-last-run-line")).toHaveTextContent(
      "Last full run at Jul 8",
    );
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
        {
          scenarioId: "s3",
          name: "Login flow",
          lastRunAt: new Date("2026-07-08T08:00:00.000Z").getTime(),
        },
      ],
    });

    expect(screen.getByText("Refund flow")).toBeInTheDocument();
    expect(screen.getByText("Checkout flow")).toBeInTheDocument();
    expect(screen.getByText("Login flow")).toBeInTheDocument();
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
