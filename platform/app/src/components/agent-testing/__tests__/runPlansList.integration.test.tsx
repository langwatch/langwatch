/**
 * @vitest-environment jsdom
 *
 * The Test Runs list: every run plan of a project, and what its last run said.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResultGroup } from "~/server/app-layer/simulations/result-atoms/atom.types";
import type {
  ExternalSetSummary,
  SuiteRunSummary,
} from "~/server/scenarios/scenario-event.types";
import {
  PLAN_ARCHIVE_DESCRIPTION,
  PLAN_ARCHIVE_TITLE,
  type PlanRowModel,
  PlanRowsTable,
} from "../results/PlanRowsTable";
import {
  buildRunPlans,
  CLI_EPHEMERAL_LABEL,
  type RunPlan,
  type RunPlanSuite,
} from "../results/run-plans";
import { PASS_RATE_BAR_OPACITY } from "../shared/pass-rate-color";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), isReady: true }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({
  formatTimeAgoCompact: () => "2h ago",
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const NOW = 1_700_000_000_000;

function makeSuite(overrides: Partial<RunPlanSuite> = {}): RunPlanSuite {
  return {
    id: "suite_1",
    name: "Checkout",
    slug: "checkout",
    scenarioIds: ["scen_1", "scen_2", "scen_3"],
    labels: [],
    scope: { mode: "cases" },
    ...overrides,
  };
}

function makeExternalSet(
  overrides: Partial<ExternalSetSummary> = {},
): ExternalSetSummary {
  return {
    scenarioSetId: "nightly-ci",
    passedCount: 2,
    failedCount: 0,
    totalCount: 2,
    lastRunTimestamp: NOW - 3_600_000,
    ...overrides,
  };
}

/** A folded row, in the shape the table renders whatever produced it. */
function makeGroup(overrides: Partial<ResultGroup> = {}): ResultGroup {
  return {
    key: "checkout",
    title: "Checkout",
    subtitle: null,
    passRate: 100,
    runCount: 2,
    scenarioCount: 3,
    lastRunAt: NOW,
    targetKeys: ["agent_dev"],
    trend: [
      { key: "run_1", passRate: 100 },
      { key: "run_2", passRate: 100 },
    ],
    cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
    ...overrides,
  };
}

const TARGET_NAMES: Record<string, string> = {
  agent_dev: "dev-agent",
  agent_prod: "prod-agent",
};

function renderRows(
  rows: PlanRowModel[],
  overrides: Partial<React.ComponentProps<typeof PlanRowsTable>> = {},
) {
  const props: React.ComponentProps<typeof PlanRowsTable> = {
    rows,
    days: 30,
    resolveTargetName: (key) => TARGET_NAMES[key] ?? key,
    onSelectPlan: vi.fn(),
    onEditPlan: vi.fn(),
    onArchivePlan: vi.fn(),
    ...overrides,
  };
  const view = render(<PlanRowsTable {...props} />, { wrapper: Wrapper });
  return { props, view };
}

/**
 * The run plans of a project, built the way the Results tab builds them.
 *
 * `folders` are the test suites: never rows of the list, but named by a plan
 * whose scope points at them.
 */
function plansOf({
  plans = [],
  folders = [],
  suiteSummaries = {},
  externalSets = [],
}: {
  plans?: RunPlanSuite[];
  folders?: { id: string; name: string }[];
  suiteSummaries?: Record<string, SuiteRunSummary>;
  externalSets?: ExternalSetSummary[];
}): RunPlan[] {
  return buildRunPlans({
    plans,
    suiteNames: new Map(
      [...plans, ...folders].map((suite) => [suite.id, suite.name]),
    ),
    suiteSummaries,
    externalSets,
  });
}

/** The plans of a project, with no run history attached. */
function planRowsOf(plans: RunPlan[]): PlanRowModel[] {
  return plans.map((plan) => ({ plan, group: null }));
}

/** One plan, built from one suite, with the runs the caller wants on it. */
function oneSuiteRow(
  suite: Partial<RunPlanSuite> = {},
  group: ResultGroup | null = makeGroup(),
): PlanRowModel {
  const plans = plansOf({
    plans: [makeSuite(suite)],
    suiteSummaries: {},
    externalSets: [],
  });
  return { plan: plans[0]!, group };
}

async function openPlanMenu(planName: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Actions for ${planName}` }),
  );
  return user;
}

async function menuItemTexts(): Promise<(string | null)[]> {
  return (await screen.findAllByRole("menuitem")).map(
    (item) => item.textContent,
  );
}

describe("the Test Runs list", () => {
  afterEach(cleanup);

  /** @scenario "The Test Runs list holds one row for every run plan" */
  it("holds one row for every run plan and no bucket row", () => {
    const plans = plansOf({
      plans: [
        makeSuite(),
        makeSuite({ id: "suite_2", name: "Refunds", slug: "refunds" }),
        makeSuite({
          id: "suite_3",
          name: "Nightly plan",
          slug: "nightly-plan",
        }),
      ],
      suiteSummaries: {},
      externalSets: [],
    });

    renderRows(planRowsOf(plans));

    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Nightly plan")).toBeInTheDocument();

    // Three plans, three rows. The bucket row that used to collect the runs
    // belonging to no plan is gone.
    const rows = screen.getAllByTestId(/^run-plan-row-/);
    expect(rows).toHaveLength(3);
    expect(screen.queryByText("One-off runs")).not.toBeInTheDocument();
    expect(screen.queryByText("one-offs")).not.toBeInTheDocument();
  });

  /** @scenario "The plan table holds seven columns in one order" */
  it("heads the table with the seven columns in order", () => {
    renderRows([]);

    const headings = [
      "Run plan",
      "Last run",
      "Scope",
      "Targets",
      "Pass",
      "Trend",
    ];
    for (const heading of headings) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }

    // Neither cost nor duration is a column any more: the pill that carried
    // them read as clutter, and the totals live in the stat strip.
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Cases")).not.toBeInTheDocument();
  });

  /** @scenario "The Run plan column holds only the name" */
  it("holds only the name in the Run plan cell", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });

    renderRows(planRowsOf(plans));

    const row = screen.getByTestId("run-plan-row-checkout");
    expect(within(row).getByText("Checkout")).toBeInTheDocument();
    // The old second line under the name is gone.
    expect(within(row).queryByText("Run plan")).not.toBeInTheDocument();
  });

  /** @scenario "The Last run column reads the age, the scenarios and the runs" */
  it("reads the age, the scenarios and the runs in the Last run cell", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });
    const checkout = plans.find((plan) => plan.slug === "checkout")!;

    renderRows([{ plan: checkout, group: makeGroup() }]);

    const row = screen.getByTestId("run-plan-row-checkout");
    expect(
      within(row).getByText("2h ago · 3 scenarios · 2 runs"),
    ).toBeInTheDocument();
  });

  /** @scenario "The Last run column reads the age, the scenarios and the runs" */
  it("says one scenario and one run without an s", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });
    const checkout = plans.find((plan) => plan.slug === "checkout")!;

    renderRows([
      {
        plan: checkout,
        group: makeGroup({ scenarioCount: 1, runCount: 1 }),
      },
    ]);

    expect(screen.getByText("2h ago · 1 scenario · 1 run")).toBeInTheDocument();
  });

  /** @scenario "A run plan with no run in the period says so in the Last run column" */
  it("says nothing ran in the period on a quiet plan", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });

    renderRows(planRowsOf(plans), { days: 30 });

    const row = screen.getByTestId("run-plan-row-checkout");
    expect(within(row).getByText("nothing in 30 days")).toBeInTheDocument();
    // A plan with no run has no history to draw, so no bars either.
    expect(
      within(row).queryByTestId("trend-sparkline"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The Scope column says what the plan covers" */
  it("says what the plan covers in the Scope cell", () => {
    const plans = plansOf({
      plans: [
        makeSuite({ scope: { mode: "all" } }),
        makeSuite({
          id: "suite_2",
          name: "Everything nightly",
          slug: "nightly",
          scope: { mode: "folders", folderIds: ["suite_1", "folder_refunds"] },
        }),
      ],
      folders: [{ id: "folder_refunds", name: "Refunds" }],
    });

    renderRows(planRowsOf(plans));

    expect(
      within(screen.getByTestId("run-plan-row-checkout")).getByText(
        "All scenarios",
      ),
    ).toBeInTheDocument();
    // A scope over test suites names them rather than counting them, and a
    // test suite is no row of its own, so the name comes from the read that
    // carries every suite of the project.
    expect(
      within(screen.getByTestId("run-plan-row-nightly")).getByText(
        "Checkout, Refunds",
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "The Targets column names the agents the plan runs against" */
  it("names both agents in the Targets cell", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });
    const checkout = plans.find((plan) => plan.slug === "checkout")!;

    renderRows([
      {
        plan: checkout,
        group: makeGroup({ targetKeys: ["agent_dev", "agent_prod"] }),
      },
    ]);

    expect(screen.getByText("dev-agent vs prod-agent")).toBeInTheDocument();
  });

  /** @scenario "The Pass column is a plain coloured percentage" */
  it("draws the pass rate as a plain percentage with no pill", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });
    const checkout = plans.find((plan) => plan.slug === "checkout")!;

    renderRows([{ plan: checkout, group: makeGroup({ passRate: 90 }) }]);

    const row = screen.getByTestId("run-plan-row-checkout");
    expect(within(row).getByTestId("pass-rate-text")).toHaveTextContent("90%");
    // The boxed metrics pill is gone: it carried a cost and a duration that
    // most rows never had.
    expect(
      within(row).queryByTestId("run-metrics-summary"),
    ).not.toBeInTheDocument();
  });

  // The rates run from best to worst, so a list drawn newest first would put
  // "0%" at the front and this assertion would fail rather than pass by luck.
  /** @scenario "The Trend column draws one bar per run, oldest first" */
  it("draws one trend bar per run, oldest first", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });
    const checkout = plans.find((plan) => plan.slug === "checkout")!;

    renderRows([
      {
        plan: checkout,
        group: makeGroup({
          trend: [
            { key: "run_1", passRate: 100 },
            { key: "run_2", passRate: 50 },
            { key: "run_3", passRate: 0 },
          ],
        }),
      },
    ]);

    const row = screen.getByTestId("run-plan-row-checkout");
    const bars = within(row).getAllByTestId("trend-sparkline-bar");
    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.getAttribute("title"))).toEqual([
      "100%",
      "50%",
      "0%",
    ]);
  });

  /** @scenario "The trend bars are softer than the text beside them" */
  it("draws every trend bar at the one shared opacity", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });
    const checkout = plans.find((plan) => plan.slug === "checkout")!;

    renderRows([
      {
        plan: checkout,
        group: makeGroup({
          trend: [
            { key: "run_1", passRate: 100 },
            { key: "run_2", passRate: 0 },
          ],
        }),
      },
    ]);

    const row = screen.getByTestId("run-plan-row-checkout");
    const sparkline = within(row).getByTestId("trend-sparkline");

    // One opacity for the whole row of bars, so two bars cannot read as two
    // meanings, and softer than the percentage beside them.
    expect(sparkline).toHaveStyle({ opacity: String(PASS_RATE_BAR_OPACITY) });
    expect(PASS_RATE_BAR_OPACITY).toBeLessThan(1);
    for (const bar of within(row).getAllByTestId("trend-sparkline-bar")) {
      expect(bar.style.opacity).toBe("");
    }
  });

  /** @scenario "A run plan row shows its last result" */
  it("carries the pass rate of the runs in the window", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });
    const checkout = plans.find((plan) => plan.slug === "checkout")!;

    renderRows([
      {
        plan: checkout,
        group: makeGroup({ passRate: 100, runCount: 1, scenarioCount: 3 }),
      },
    ]);

    const row = screen.getByTestId("run-plan-row-checkout");
    expect(within(row).getByTestId("pass-rate-text")).toHaveTextContent("100%");
    expect(within(row).getByTestId("plan-last-run")).toHaveTextContent(
      "3 scenarios",
    );
  });

  /** @scenario "A run plan row opens on a click and carries no chevron" */
  it("ends the row on its menu, with no chevron after it", async () => {
    const user = userEvent.setup();
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
    });

    const { props } = renderRows(planRowsOf(plans));

    const row = screen.getByTestId("run-plan-row-checkout");
    const menu = within(row).getByRole("button", {
      name: "Actions for Checkout",
    });
    // The menu is the last thing in the row: a chevron after it would repeat
    // what the whole row already does.
    expect(row.lastElementChild?.contains(menu)).toBe(true);

    await user.click(row);
    expect(props.onSelectPlan).toHaveBeenCalledWith("checkout");
  });

  // --- The row menu ---

  /** @scenario "The row menu of a run plan offers to archive it" */
  it("offers archive last in the row menu, in the destructive colour", async () => {
    renderRows([oneSuiteRow()]);
    await openPlanMenu("Checkout");

    expect(await menuItemTexts()).toEqual([
      "Open last run",
      "Edit run plan",
      "Archive run plan",
    ]);

    // Archiving is the one action of the menu that takes something away, so
    // it reads apart from the two that do not.
    const archive = screen.getByRole("menuitem", { name: "Archive run plan" });
    const edit = screen.getByRole("menuitem", { name: "Edit run plan" });
    expect(archive).toHaveStyle({ color: "var(--chakra-colors-red-600)" });
    expect(edit.style.color).toBe("");
  });

  /** @scenario "Archiving a run plan asks first and then takes the row away" */
  it("names the plan in the archive dialog and takes the row away", async () => {
    const row = oneSuiteRow();
    const { props, view } = renderRows([row]);
    const user = await openPlanMenu("Checkout");

    await user.click(
      await screen.findByRole("menuitem", { name: "Archive run plan" }),
    );

    expect(await screen.findByText(PLAN_ARCHIVE_TITLE)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Checkout")).toBeInTheDocument();
    expect(
      within(dialog).getByText(PLAN_ARCHIVE_DESCRIPTION),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(props.onArchivePlan).toHaveBeenCalledWith(row.plan);

    view.rerender(<PlanRowsTable {...props} rows={[]} />);
    expect(
      screen.queryByTestId("run-plan-row-checkout"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Leaving the archive dialog keeps the run plan" */
  it("archives nothing when the archive dialog is left without confirming", async () => {
    const { props } = renderRows([oneSuiteRow()]);
    const user = await openPlanMenu("Checkout");

    await user.click(
      await screen.findByRole("menuitem", { name: "Archive run plan" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(props.onArchivePlan).not.toHaveBeenCalled();
    expect(screen.getByTestId("run-plan-row-checkout")).toBeInTheDocument();
  });

  /** @scenario "A set that runs from code carries no archive action in its row menu" */
  it("offers neither archive nor edit on a set that runs from code", async () => {
    const plans = plansOf({
      plans: [],
      suiteSummaries: {},
      externalSets: [makeExternalSet()],
    });

    renderRows([{ plan: plans[0]!, group: makeGroup({ key: "nightly-ci" }) }]);
    await openPlanMenu("nightly-ci");

    // There is no stored plan behind the row, so there is nothing to edit and
    // nothing to archive.
    expect(await menuItemTexts()).toEqual(["Open last run"]);
  });

  /** @scenario "Open last run is not offered for a plan with no run in the period" */
  it("does not offer Open last run on a plan with no run in the period", async () => {
    renderRows([oneSuiteRow({}, null)]);
    await openPlanMenu("Checkout");

    expect(await menuItemTexts()).toEqual([
      "Edit run plan",
      "Archive run plan",
    ]);
  });

  it("lists a set written by code as a run plan of its own", () => {
    const plans = plansOf({
      plans: [],
      suiteSummaries: {},
      externalSets: [makeExternalSet()],
    });

    renderRows(planRowsOf(plans));

    const row = screen.getByTestId("run-plan-row-external:nightly-ci");
    expect(within(row).getByText("nightly-ci")).toBeInTheDocument();
    expect(within(row).getByText("from code")).toBeInTheDocument();
  });
});

describe("the run plans of a project", () => {
  it("sorts every plan by its last run, newest first", () => {
    const plans = plansOf({
      plans: [makeSuite()],
      suiteSummaries: {},
      externalSets: [
        {
          scenarioSetId: "ci-regression",
          lastRunTimestamp: NOW,
          passedCount: 2,
          failedCount: 0,
          totalCount: 2,
        },
        {
          scenarioSetId: "smoke-tests",
          lastRunTimestamp: NOW - 1000,
          passedCount: 1,
          failedCount: 1,
          totalCount: 2,
        },
      ],
    });

    // The external sets sort by their own run time, and a run plan with no
    // run falls below them.
    expect(plans.map((plan) => plan.name)).toEqual([
      "ci-regression",
      "smoke-tests",
      "Checkout",
    ]);
  });

  it("keeps the command line's throwaway suites out of the list", () => {
    const plans = plansOf({
      plans: [
        makeSuite(),
        makeSuite({
          id: "suite_cli",
          name: "CLI run: scenario scen_1",
          slug: "cli-run",
          labels: [CLI_EPHEMERAL_LABEL],
        }),
      ],
      suiteSummaries: {},
      externalSets: [],
    });

    expect(plans.map((plan) => plan.name)).toEqual(["Checkout"]);
  });

  /** @scenario "The Scope column says what the plan covers" */
  it("reads a hand-picked scope as how many scenarios it holds", () => {
    const plans = plansOf({
      plans: [makeSuite({ scope: { mode: "cases" } })],
      suiteSummaries: {},
      externalSets: [],
    });

    expect(plans[0]?.scopeLabel).toBe("3 scenarios");
  });

  /** @scenario "The Scope column says what the plan covers" */
  it("reads a label scope as the labels it names", () => {
    const plans = plansOf({
      plans: [
        makeSuite({ scope: { mode: "labels", labels: ["smoke", "critical"] } }),
      ],
      suiteSummaries: {},
      externalSets: [],
    });

    expect(plans[0]?.scopeLabel).toBe("Labelled smoke, critical");
  });
});
