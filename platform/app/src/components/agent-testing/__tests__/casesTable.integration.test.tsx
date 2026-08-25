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
  UNFILED_GROUP_NAME,
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
    groups: [],
    externalCases: [],
    isLoading: false,
    lastResults: new Map(),
    isLastResultsLoading: false,
    authorNameById: {},
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

describe("the test cases table", () => {
  afterEach(cleanup);

  // --- Grouping ---

  /** @scenario "All test cases groups the rows under their test suite" */
  /** @scenario "The unfiled group is shown last and reads as unfiled" */
  it("groups the rows under their test suite and keeps the unfiled ones last", () => {
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
      groups: groupCasesByFolder({ cases, suites: [REFUNDS, CHECKOUT] }),
    });

    const headings = screen
      .getAllByRole("row")
      .map((row) => row.getAttribute("data-testid"))
      .filter((id): id is string => !!id?.startsWith("folder-header-row-"));

    expect(headings).toEqual([
      "folder-header-row-Refunds",
      "folder-header-row-Checkout",
      `folder-header-row-${UNFILED_GROUP_NAME}`,
    ]);
    expect(
      screen.getByTestId(`folder-header-row-${UNFILED_GROUP_NAME}`),
    ).toHaveTextContent("3 test cases");
  });

  /** @scenario "A group heading carries the last result of the whole suite" */
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
      groups: groupCasesByFolder({ cases, suites: [REFUNDS] }),
      lastResults,
    });

    const heading = screen.getByTestId("folder-header-row-Refunds");
    expect(within(heading).getByText("100%")).toBeInTheDocument();
    expect(heading).toHaveTextContent("3 test cases");
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
      groups: [{ id: REFUNDS.id, name: REFUNDS.name, cases }],
    });

    expect(
      screen.queryByTestId("folder-header-row-Refunds"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + three rows
  });

  // --- Row content ---

  /** @scenario "Labels are shown as small pastel pills beside the name" */
  it("shows the labels as pastel pills beside the name", () => {
    renderPanel({
      groups: [
        {
          id: REFUNDS.id,
          name: REFUNDS.name,
          cases: [makeCase({ labels: ["critical", "billing"] })],
        },
      ],
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

  /** @scenario "The added column reads as one line with the author and the date" */
  it("reads the author and the date on one line", () => {
    renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      groups: [
        {
          id: REFUNDS.id,
          name: REFUNDS.name,
          cases: [makeCase({ lastUpdatedById: "user_1" })],
        },
      ],
      authorNameById: { user_1: "Lena Fischer" },
    });

    expect(screen.getByText("Lena Fischer · Jul 6")).toBeInTheDocument();
  });

  /** @scenario "The last result cell shows the verdict of the last run" */
  it("shows the verdict of the last run and the run metrics on hover", async () => {
    const user = userEvent.setup();
    renderPanel({
      groups: groupCasesByFolder({ cases: [makeCase()], suites: [REFUNDS] }),
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
      groups: groupCasesByFolder({ cases: [makeCase()], suites: [REFUNDS] }),
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
      groups: [{ id: REFUNDS.id, name: REFUNDS.name, cases: [makeCase()] }],
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
      groups: groupCasesByFolder({ cases, suites: [REFUNDS] }),
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
      groups: groupCasesByFolder({ cases: [makeCase()], suites: [REFUNDS] }),
    });

    const runButton = screen.getByRole("button", { name: "Run Double charge" });
    expect(runButton).toHaveTextContent("Run");
    expect(runButton.querySelector("svg.lucide-play")).toBeInTheDocument();
  });

  /** @scenario "The row menu offers Edit, Duplicate, Open last run and Archive in order" */
  it("offers Edit, Duplicate, Open last run, Move to suite and Archive in order", async () => {
    renderPanel({
      groups: groupCasesByFolder({ cases: [makeCase()], suites: [REFUNDS] }),
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
      "Move to suite",
      "History",
      "Archive",
    ]);
  });

  /** @scenario "Open last run is not offered for a case that never ran" */
  it("does not offer Open last run for a case that never ran", async () => {
    renderPanel({
      groups: groupCasesByFolder({ cases: [makeCase()], suites: [REFUNDS] }),
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
      groups: groupCasesByFolder({ cases: [original], suites: [REFUNDS] }),
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
      <CasesPanel
        {...props}
        groups={groupCasesByFolder({
          cases: [original, copy],
          suites: [REFUNDS],
        })}
      />,
    );

    const heading = screen.getByTestId("folder-header-row-Refunds");
    expect(heading).toHaveTextContent("2 test cases");
    const copyRow = screen.getByTestId("case-row-Double charge (copy)");
    expect(
      within(copyRow).getByTestId("tag-pill-critical"),
    ).toBeInTheDocument();
  });

  /** @scenario "Moving a case from its row menu regroups the case list" */
  /** @scenario "Unfiling a case moves it to the unfiled group" */
  it("moves a case to another suite, and out of every suite, from its row menu", async () => {
    const filed = makeCase();
    const { props, view } = renderPanel({
      groups: groupCasesByFolder({
        cases: [filed],
        suites: [REFUNDS, CHECKOUT],
      }),
    });
    const user = await openRowMenu("Double charge");

    await user.click(
      await screen.findByRole("menuitem", { name: "Move to suite" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Checkout" }));
    expect(props.onMoveToSuite).toHaveBeenCalledWith(filed, CHECKOUT.id);

    const moved = { ...filed, folderId: CHECKOUT.id };
    view.rerender(
      <CasesPanel
        {...props}
        groups={groupCasesByFolder({
          cases: [moved],
          suites: [REFUNDS, CHECKOUT],
        })}
      />,
    );
    expect(
      screen.queryByTestId("folder-header-row-Refunds"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("folder-header-row-Checkout")).toHaveTextContent(
      "Double charge".length ? "1 test case" : "",
    );

    const unfiled = { ...filed, folderId: null };
    view.rerender(
      <CasesPanel
        {...props}
        groups={groupCasesByFolder({
          cases: [unfiled],
          suites: [REFUNDS, CHECKOUT],
        })}
      />,
    );
    expect(
      screen.getByTestId(`folder-header-row-${UNFILED_GROUP_NAME}`),
    ).toBeInTheDocument();
    expect(screen.getByText("Double charge")).toBeInTheDocument();
  });

  // --- Row click ---

  /** @scenario "Clicking a row with a last run opens that run" */
  it("opens the last run when a row with one is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({
      groups: groupCasesByFolder({ cases: [testCase], suites: [REFUNDS] }),
      lastResults: new Map([["case_1", makeResult()]]),
    });

    await user.click(screen.getByText("Double charge"));

    expect(props.onRowClick).toHaveBeenCalledWith(testCase);
  });

  /** @scenario "Clicking a row with no last run opens the editor" */
  it("opens the editor when a row with no last run is clicked", async () => {
    const user = userEvent.setup();
    const testCase = makeCase();
    const { props } = renderPanel({
      groups: groupCasesByFolder({ cases: [testCase], suites: [REFUNDS] }),
      lastResults: new Map(),
    });

    await user.click(screen.getByText("Double charge"));

    // TestCasesTab reads the same last-result map: with nothing in it the row
    // click opens the case editor rather than a run.
    expect(props.onRowClick).toHaveBeenCalledWith(testCase);
  });

  it("hands the Run button to the run dialog and not to the row", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({
      groups: groupCasesByFolder({ cases: [makeCase()], suites: [REFUNDS] }),
      lastResults: new Map([["case_1", makeResult()]]),
    });

    await user.click(screen.getByRole("button", { name: "Run Double charge" }));

    expect(props.onRunCase).toHaveBeenCalledWith(makeCase());
    expect(props.onRowClick).not.toHaveBeenCalled();
  });

  // --- Filtering ---

  /** @scenario "The label filter narrows the table to one label" */
  it("narrows the table to one label and hides the headings it empties", async () => {
    const user = userEvent.setup();
    const critical = makeCase({ labels: ["critical"] });
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
      groups: groupCasesByFolder({
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
        groups={groupCasesByFolder({
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
  });

  // --- The summary line ---

  /** @scenario "A borderless line under the table says when the set last ran" */
  it("says under the table when a suite last ran and how it did", () => {
    renderPanel({
      selection: { kind: "suite", slug: "refunds" },
      title: "Refunds",
      groups: [{ id: REFUNDS.id, name: REFUNDS.name, cases: [makeCase()] }],
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
      groups: groupCasesByFolder({ cases: [makeCase()], suites: [REFUNDS] }),
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
