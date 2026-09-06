/**
 * @vitest-environment jsdom
 *
 * The rail of the Scenarios tab: the test suites, the sets that run from code,
 * the period picker at its foot, and the one dialog that names a suite.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/suites/test-suites.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeRelativeWindow } from "~/components/PeriodSelector";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { SuiteNameDialog } from "../cases/SuiteNameDialog";
import { SuiteRail } from "../cases/SuiteRail";
import {
  orderSuitesDefaultFirst,
  type TestSuiteEntry,
} from "../cases/test-cases";
import type { SuiteLastRun } from "../cases/useTestCasesData";

const routerPush = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: routerPush,
    isReady: true,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({
  formatTimeAgoCompact: () => "2h ago",
  formatTimeAgo: () => "2 hours ago",
}));

// The recent runs of a suite hang off its row menu, so opening that submenu
// reads the runs of the whole project and narrows them to the suite.
const suiteRunDataQuery = vi.fn();
const suitesGetAllQuery = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      getSuiteRunData: {
        useQuery: (...args: unknown[]) => suiteRunDataQuery(...args),
      },
    },
    suites: {
      getAll: { useQuery: (...args: unknown[]) => suitesGetAllQuery(...args) },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const THIRTY_DAYS = computeRelativeWindow("30d", new Date());

/** The last run of a suite, as the rail is handed it. */
function makeLastRun(overrides: Partial<SuiteLastRun> = {}): SuiteLastRun {
  return {
    batchRunId: "batch_1",
    scenarioSetId: "__internal__suite_refunds__suite",
    lastRunAt: new Date("2026-07-08T09:30:00.000Z").getTime(),
    ...overrides,
  };
}

function makeSuite(overrides: Partial<TestSuiteEntry> = {}): TestSuiteEntry {
  return {
    id: "suite_1",
    name: "Refunds",
    slug: "refunds",
    caseCount: 3,
    ...overrides,
  };
}

function renderRail(
  overrides: Partial<React.ComponentProps<typeof SuiteRail>> = {},
) {
  const props: React.ComponentProps<typeof SuiteRail> = {
    selectedSuiteId: null,
    selectedExternalSetId: null,
    suites: [makeSuite()],
    externalSets: [],
    canManage: true,
    lastRunBySuiteId: new Map<string, SuiteLastRun>([
      ["suite_1", makeLastRun()],
    ]),
    scenarioIdsBySuiteId: new Map<string, string[]>([
      ["suite_1", ["case_1"]],
      ["suite_default", ["case_1"]],
    ]),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onSelect: vi.fn(),
    onNewSuite: vi.fn(),
    onNewTestCase: vi.fn(),
    onRunSuite: vi.fn(),
    onRenameSuite: vi.fn(),
    onArchiveSuite: vi.fn(),
    period: THIRTY_DAYS,
    periodMode: "relative",
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
    ...overrides,
  };
  const view = render(<SuiteRail {...props} />, { wrapper: Wrapper });
  return { props, view };
}

async function openSuiteMenu(suiteName: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Actions for ${suiteName}` }),
  );
  return user;
}

/** The rail entries, in reading order. */
function railEntries(): string[] {
  const rail = screen.getByTestId("agent-testing-suite-rail");
  return within(rail)
    .getAllByRole("button")
    .map((element) => element.getAttribute("data-testid"))
    .filter((id): id is string => !!id?.startsWith("suite-rail-item-"));
}

/**
 * Two batches of the project: one that covered a scenario of Refunds, and one
 * that covered a scenario of another suite. Narrowing to the open suite is the
 * work the submenu does, so a fixture holding only its own runs would prove
 * nothing.
 */
const TWO_HOURS_AGO = Date.now() - 2 * 60 * 60 * 1000 - 60_000;

const REFUNDS_SET = "__internal__suite_1__suite";
const OTHER_SET = "__internal__suite_2__suite";

function makeProjectRun(
  overrides: Partial<ScenarioRunData> = {},
): ScenarioRunData {
  return {
    scenarioId: "case_1",
    batchRunId: "batch_refunds",
    scenarioRunId: "run_refunds",
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

/** Hands the two reads their answer: the runs, and the set each batch is of. */
function setProjectRuns(runs: ScenarioRunData[]) {
  suiteRunDataQuery.mockReturnValue({
    data: {
      runs,
      scenarioSetIds: {
        batch_refunds: REFUNDS_SET,
        batch_elsewhere: OTHER_SET,
      },
    },
    isLoading: false,
  });
}

describe("the test suites rail", () => {
  afterEach(cleanup);

  beforeEach(() => {
    routerPush.mockClear();
    setProjectRuns([]);
    suitesGetAllQuery.mockReturnValue({
      data: [
        { id: "suite_1", name: "Refunds", slug: "refunds" },
        { id: "suite_2", name: "Checkout", slug: "checkout" },
      ],
      isLoading: false,
    });
  });

  // --- What is listed ---

  /** @scenario "The rail lists the test suites, then the external sets" */
  it("lists the test suites, then the external sets, and no counts", () => {
    renderRail({
      suites: [
        makeSuite(),
        makeSuite({ id: "suite_2", name: "Checkout", slug: "checkout" }),
      ],
      externalSets: [{ setId: "nightly-ci", lastRunTimestamp: 1 }],
    });

    expect(screen.getByText("Test Suites")).toBeInTheDocument();
    expect(screen.getByText("From Code")).toBeInTheDocument();
    expect(railEntries()).toEqual([
      "suite-rail-item-Refunds",
      "suite-rail-item-Checkout",
      "suite-rail-item-nightly-ci",
    ]);

    // No row carries a count and no row carries a time: how many scenarios a set
    // holds reads beside the panel title, once.
    for (const entry of railEntries()) {
      expect(screen.getByTestId(entry).textContent).not.toMatch(/\d/);
    }
  });

  /** @scenario "The rail offers no root list of every scenario" */
  it("offers no All scenarios entry and no heading that leads anywhere", () => {
    renderRail({
      suites: [makeSuite()],
      externalSets: [{ setId: "nightly-ci", lastRunTimestamp: 1 }],
    });

    expect(
      screen.queryByTestId("suite-rail-item-All scenarios"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("All scenarios")).not.toBeInTheDocument();
    // The headings are plain labels: their destination is gone.
    expect(screen.getByText("Test Suites").tagName).not.toBe("BUTTON");
    expect(screen.getByText("From Code").tagName).not.toBe("BUTTON");
  });

  /** @scenario "The Default suite is listed first" */
  it("moves Default to the front and keeps the rest in their order", () => {
    // The migration wrote Default last, so the read hands it over last.
    const asRead = [
      makeSuite({ id: "suite_2", name: "Checkout", slug: "checkout" }),
      makeSuite(),
      makeSuite({ id: "suite_default", name: "Default", slug: "default" }),
    ];

    renderRail({ suites: orderSuitesDefaultFirst(asRead) });

    expect(railEntries()).toEqual([
      "suite-rail-item-Default",
      "suite-rail-item-Checkout",
      "suite-rail-item-Refunds",
    ]);
  });

  it("leaves a renamed Default where the read put it", () => {
    const asRead = [
      makeSuite({ id: "suite_2", name: "Checkout", slug: "checkout" }),
      makeSuite({
        id: "suite_default",
        name: "Everything else",
        slug: "default",
      }),
    ];

    expect(orderSuitesDefaultFirst(asRead).map((suite) => suite.name)).toEqual([
      "Checkout",
      "Everything else",
    ]);
  });

  /** @scenario "The Default suite carries the actions of an ordinary suite" */
  it("gives Default the same row menu as any other suite", async () => {
    renderRail({
      suites: [
        makeSuite({ id: "suite_default", name: "Default", slug: "default" }),
      ],
      lastRunBySuiteId: new Map<string, SuiteLastRun>([
        ["suite_default", makeLastRun()],
      ]),
    });
    await openSuiteMenu("Default");

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "New scenario",
      "Run suite",
      "Rename",
      "Open recent runs",
      "Archive suite",
    ]);
  });

  it("keeps the row menu beside the selection control, not inside it", () => {
    renderRail();

    const select = screen.getByTestId("suite-rail-item-Refunds");
    expect(select.tagName).toBe("BUTTON");
    const menu = screen.getByLabelText("Actions for Refunds");
    expect(menu.tagName).toBe("BUTTON");
    // A control inside a control takes the keypress meant for the inner one.
    expect(select.contains(menu)).toBe(false);
  });

  /** @scenario "An external set carries the code icon and no counts" */
  it("carries the code icon on an external set, and no Run", () => {
    renderRail({
      suites: [],
      externalSets: [{ setId: "nightly-ci", lastRunTimestamp: 1 }],
    });

    const row = screen.getByTestId("suite-rail-item-nightly-ci");
    expect(within(row).getByLabelText("Runs from code")).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /Actions for/ }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A project with no external sets hides the From Code heading" */
  it("hides the From Code heading when the project has none", () => {
    renderRail({ externalSets: [] });

    expect(screen.queryByText("From Code")).not.toBeInTheDocument();
  });

  /** @scenario "The rail offers to create a test suite" */
  it("offers to create a test suite and lists the new one", async () => {
    const user = userEvent.setup();
    const { props, view } = renderRail({ suites: [] });

    await user.click(screen.getByRole("button", { name: "New Test Suite" }));
    expect(props.onNewSuite).toHaveBeenCalled();

    view.rerender(<SuiteRail {...props} suites={[makeSuite()]} />);
    expect(screen.getByTestId("suite-rail-item-Refunds")).toBeInTheDocument();
  });

  // --- The row menu ---

  /** @scenario "The row menu of a test suite offers its five actions in order" */
  it("offers its five actions in order", async () => {
    renderRail();
    await openSuiteMenu("Refunds");

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "New scenario",
      "Run suite",
      "Rename",
      "Open recent runs",
      "Archive suite",
    ]);
  });

  describe("given the project ran batches of this suite and of another", () => {
    describe("when Open recent runs is chosen", () => {
      /** @scenario "Open recent runs holds the runs that covered the suite" */
      it("lists the runs that covered the suite and opens one under its plan", async () => {
        setProjectRuns([
          makeProjectRun(),
          makeProjectRun({
            batchRunId: "batch_elsewhere",
            scenarioRunId: "run_elsewhere",
            scenarioId: "case_elsewhere",
          }),
        ]);
        renderRail();
        const user = await openSuiteMenu("Refunds");

        await user.click(
          await screen.findByRole("menuitem", { name: /Open recent runs/ }),
        );

        const list = await screen.findByTestId("recent-runs-submenu-list");
        const rows = within(list).getAllByTestId(/^recent-run-/);
        expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
          "recent-run-batch_refunds",
        ]);
        expect(rows[0]).toHaveTextContent("Refunds");

        await user.click(rows[0]!);

        // The row opens the run under the plan that holds it, on the Results tab.
        expect(routerPush).toHaveBeenCalledWith(
          expect.objectContaining({
            pathname: "/[project]/agent-testing/[[...path]]",
          }),
          expect.stringContaining("/results/refunds/batch_refunds"),
          { shallow: true },
        );
      });
    });
  });

  /** @scenario "Every action of the rail row menu carries its icon" */
  it("carries an icon on every action of the row menu", async () => {
    renderRail();
    await openSuiteMenu("Refunds");

    const icons = (await screen.findAllByRole("menuitem")).map((item) =>
      item.querySelector("svg")?.getAttribute("class"),
    );

    expect(icons).toEqual([
      expect.stringContaining("lucide-plus"),
      expect.stringContaining("lucide-play"),
      expect.stringContaining("lucide-pencil"),
      expect.stringContaining("lucide-list-checks"),
      expect.stringContaining("lucide-archive"),
    ]);
  });

  describe("given the suite never ran", () => {
    describe("when the row menu is opened", () => {
      /** @scenario "Open recent runs is not offered for a suite that never ran" */
      it("does not offer Open recent runs", async () => {
        renderRail({ lastRunBySuiteId: new Map<string, SuiteLastRun>() });
        await openSuiteMenu("Refunds");

        expect(
          await screen.findByRole("menuitem", { name: "Run suite" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("menuitem", { name: /Open recent runs/ }),
        ).not.toBeInTheDocument();
      });
    });
  });

  /** @scenario "Archive suite opens the confirmation dialog" */
  /** @scenario "The archive dialog names the test suite and says what happens to its scenarios" */
  it("names the suite in the archive dialog and says its scenarios go with it", async () => {
    const { props, view } = renderRail();
    const user = await openSuiteMenu("Refunds");

    await user.click(
      await screen.findByRole("menuitem", { name: "Archive suite" }),
    );

    expect(await screen.findByText("Archive test suite?")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Refunds")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "The scenarios in it are archived as well. Test runs are preserved.",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(props.onArchiveSuite).toHaveBeenCalledWith("suite_1");

    view.rerender(<SuiteRail {...props} suites={[]} />);
    expect(
      screen.queryByTestId("suite-rail-item-Refunds"),
    ).not.toBeInTheDocument();
  });

  it("archives nothing when the archive dialog is left without confirming", async () => {
    const { props } = renderRail();
    const user = await openSuiteMenu("Refunds");

    await user.click(
      await screen.findByRole("menuitem", { name: "Archive suite" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(props.onArchiveSuite).not.toHaveBeenCalled();
  });

  /** @scenario "A person with read-only access sees no changing actions in the row menu" */
  it("offers only Open recent runs to a person with read-only access", async () => {
    renderRail({ canManage: false });
    await openSuiteMenu("Refunds");

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual(["Open recent runs"]);
    expect(
      screen.queryByRole("button", { name: "New Test Suite" }),
    ).not.toBeInTheDocument();
  });

  // --- Selection ---

  /** @scenario "Choosing a suite filters the scenario table to that suite" */
  it("asks for the chosen suite and marks the open one as selected", async () => {
    const user = userEvent.setup();
    const suites = [
      makeSuite(),
      makeSuite({ id: "suite_2", name: "Checkout", slug: "checkout" }),
    ];
    const { props, view } = renderRail({ suites });

    await user.click(screen.getByTestId("suite-rail-item-Refunds"));
    expect(props.onSelect).toHaveBeenCalledWith({
      kind: "suite",
      slug: "refunds",
    });

    view.rerender(
      <SuiteRail {...props} suites={suites} selectedSuiteId="suite_1" />,
    );
    expect(screen.getByTestId("suite-rail-item-Refunds")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByTestId("suite-rail-item-Checkout")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the first suite while the address names none, because that is the one open", () => {
    // The address alone cannot know the rail, so the rail is told which suite
    // the tab resolved to rather than which one was asked for.
    renderRail({
      suites: [
        makeSuite({ id: "suite_default", name: "Default", slug: "default" }),
        makeSuite(),
      ],
      selectedSuiteId: "suite_default",
    });

    expect(screen.getByTestId("suite-rail-item-Default")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  /** @scenario "Choosing an external set opens its results" */
  it("opens the results of an external set and offers no Edit for it", async () => {
    const user = userEvent.setup();
    const { props } = renderRail({
      externalSets: [{ setId: "nightly-ci", lastRunTimestamp: 1 }],
    });

    await user.click(screen.getByTestId("suite-rail-item-nightly-ci"));

    expect(props.onSelect).toHaveBeenCalledWith({
      kind: "external",
      setId: "nightly-ci",
    });
    expect(
      screen.queryByRole("menuitem", { name: "Rename" }),
    ).not.toBeInTheDocument();
  });

  // --- The suite editor ---

  describe("when the suite editor is opened", () => {
    function renderEditor(
      overrides: Partial<React.ComponentProps<typeof SuiteNameDialog>> = {},
    ) {
      const props: React.ComponentProps<typeof SuiteNameDialog> = {
        open: true,
        initialName: "Refunds",
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        ...overrides,
      };
      render(<SuiteNameDialog {...props} />, { wrapper: Wrapper });
      return { props };
    }

    /** @scenario "Rename opens a small centered dialog holding only a Name field" */
    it("opens a small centered dialog holding only a Name field", () => {
      renderEditor();

      const dialog = screen.getByTestId("agent-testing-suite-name-dialog");
      expect(within(dialog).getByText("Rename test suite")).toBeInTheDocument();
      const name = within(dialog).getByLabelText("Test suite name");
      expect(name).toHaveValue("Refunds");
      expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    });

    /** @scenario "The name dialog carries no targets, no models, no repeat count and no evaluators" */
    it("carries no targets, no models, no repeat count and no tab strip", () => {
      renderEditor();

      const dialog = screen.getByTestId("agent-testing-suite-name-dialog");
      for (const gone of [
        "General",
        "Simulation models",
        "Execution",
        "User simulator",
        "Judge",
        "Repeat count",
        "Labels",
      ]) {
        expect(within(dialog).queryByText(gone)).not.toBeInTheDocument();
      }
      expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("spinbutton")).not.toBeInTheDocument();
    });

    /** @scenario "The name dialog does not manage which scenarios are in the suite" */
    it("lists no scenarios and offers no way to add or remove one", () => {
      renderEditor();

      const dialog = screen.getByTestId("agent-testing-suite-name-dialog");
      expect(within(dialog).queryByText("Scenarios")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "Add scenarios" }),
      ).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    });

    /** @scenario "Saving the name dialog renames the suite" */
    it("renames the suite on save", async () => {
      const user = userEvent.setup();
      const { props } = renderEditor();

      const name = screen.getByLabelText("Test suite name");
      await user.clear(name);
      await user.type(name, "Refunds and returns");
      await user.click(screen.getByTestId("suite-name-confirm"));

      expect(props.onConfirm).toHaveBeenCalledWith("Refunds and returns");
    });

    /** @scenario "The name dialog refuses an empty name" */
    it("refuses an empty name and saves nothing", async () => {
      const user = userEvent.setup();
      const { props } = renderEditor();

      await user.clear(screen.getByLabelText("Test suite name"));
      await user.click(screen.getByTestId("suite-name-confirm"));

      expect(screen.getByTestId("suite-name-problem")).toHaveTextContent(
        "A test suite needs a name.",
      );
      expect(props.onConfirm).not.toHaveBeenCalled();
    });

    /** @scenario "The name dialog offers no destructive action" */
    it("offers only Cancel and Save", () => {
      renderEditor();

      const dialog = screen.getByTestId("agent-testing-suite-name-dialog");
      const actions = within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent)
        .filter((label) => !!label);
      expect(actions).toEqual(["Cancel", "Save"]);
    });

    /** @scenario "Naming the first test suite opens it" */
    it("reads as a create when it is opened on no suite", async () => {
      const user = userEvent.setup();
      const { props } = renderEditor({ initialName: "" });

      const dialog = screen.getByTestId("agent-testing-suite-name-dialog");
      expect(within(dialog).getByText("New test suite")).toBeInTheDocument();
      await user.type(screen.getByLabelText("Test suite name"), "Refunds");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(props.onConfirm).toHaveBeenCalledWith("Refunds");
    });
  });

  // --- The period picker ---

  /** @scenario "The period picker sits at the foot of the rail and starts at thirty days" */
  it("puts a compact thirty day period picker at the foot of the rail", () => {
    renderRail();

    const rail = screen.getByTestId("agent-testing-suite-rail");
    const picker = within(rail).getByTestId("results-period-picker");
    expect(picker).toHaveAccessibleName("Last 30 days");
    expect(picker).toHaveTextContent("30d");
  });

  /** @scenario "The period picker opens upward at the foot of the rail" */
  it("offers the same ranges as the shared period control, any date included", async () => {
    const user = userEvent.setup();
    renderRail();

    await user.click(screen.getByTestId("results-period-picker"));

    expect(await screen.findByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Last 90 days")).toBeInTheDocument();
    expect(screen.getByText("Last 1 year")).toBeInTheDocument();
    // A free start and end date, so windows older than thirty days can be
    // read too.
    expect(screen.getByLabelText("Start Date")).toBeInTheDocument();
    expect(screen.getByLabelText("End Date")).toBeInTheDocument();
    expect(screen.queryByText(/cold storage/i)).not.toBeInTheDocument();
  });

  /** @scenario "The period picker opens upward at the foot of the rail" */
  it("hands a freely typed start date back as the new window", async () => {
    const user = userEvent.setup();
    const { props } = renderRail();

    await user.click(screen.getByTestId("results-period-picker"));
    fireEvent.change(await screen.findByLabelText("Start Date"), {
      target: { value: "2026-01-15T09:30" },
    });

    // The free dates are the reason the rail took the shared control, so the
    // window has to travel, not only render.
    expect(props.setPeriod).toHaveBeenCalledTimes(1);
    const [startDate] = vi.mocked(props.setPeriod).mock.calls[0] as [
      Date,
      Date,
    ];
    expect(startDate.getFullYear()).toBe(2026);
    expect(startDate.getMonth()).toBe(0);
  });

  /** @scenario "Changing the period reloads the last results and the runs" */
  it("reloads on a shorter period", async () => {
    const user = userEvent.setup();
    const { props } = renderRail();

    await user.click(screen.getByTestId("results-period-picker"));
    await user.click(await screen.findByText("Last 7 days"));

    // usePeriodSelector writes the window into the address, and every read of
    // the tab is keyed by that window, so the cells and the runs come back for
    // the shorter period.
    expect(props.setRelativePeriod).toHaveBeenCalledWith("7d");
  });

  /** @scenario "The rail carries the new-simulations announcement" */
  it("carries the new-simulations announcement", () => {
    renderRail();

    expect(
      screen.getByText("Welcome to the new simulations screen"),
    ).toBeInTheDocument();
  });
});
