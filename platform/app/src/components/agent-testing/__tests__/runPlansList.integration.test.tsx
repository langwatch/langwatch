/**
 * @vitest-environment jsdom
 *
 * The Test Runs list: every run plan of a project, what its last run said and
 * where One-off runs sits.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/one-off-runs-surface.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResultGroup } from "~/server/app-layer/simulations/result-atoms/atom.types";
import type { ExternalSetSummary } from "~/server/scenarios/scenario-event.types";
import { type PlanRowModel, PlanRowsTable } from "../results/PlanRowsTable";
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

const PROJECT_ID = "proj_1";
const NOW = 1_700_000_000_000;

function makeSuite(overrides: Partial<RunPlanSuite> = {}): RunPlanSuite {
  return {
    id: "suite_1",
    name: "Checkout",
    slug: "checkout",
    scenarioIds: ["scen_1", "scen_2", "scen_3"],
    labels: [],
    kind: "custom",
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
    ...overrides,
  };
  render(<PlanRowsTable {...props} />, { wrapper: Wrapper });
  return props;
}

/** The plans of a project, with no run history attached. */
function planRowsOf(plans: RunPlan[]): PlanRowModel[] {
  return plans.map((plan) => ({ plan, group: null }));
}

describe("the Test Runs list", () => {
  afterEach(cleanup);

  /** @scenario "The Test Runs list holds every run plan with One-off runs last" */
  it("holds every run plan with One-off runs last", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [
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
      oneOffLastRun: {
        passedCount: 1,
        failedCount: 0,
        settledCount: 1,
        lastRunTimestamp: NOW,
      },
    });

    renderRows(planRowsOf(plans));

    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Nightly plan")).toBeInTheDocument();

    const rows = screen.getAllByTestId(/^run-plan-row-/);
    expect(rows).toHaveLength(4);
    expect(within(rows[3]!).getByText("One-off runs")).toBeInTheDocument();
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    renderRows(planRowsOf(plans));

    const row = screen.getByTestId("run-plan-row-checkout");
    expect(within(row).getByText("Checkout")).toBeInTheDocument();
    // The old second line under the name is gone.
    expect(within(row).queryByText("Run plan")).not.toBeInTheDocument();
  });

  /** @scenario "The Last run column reads the age, the scenarios and the runs" */
  it("reads the age, the scenarios and the runs in the Last run cell", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [
        makeSuite({ scope: { mode: "all" } }),
        makeSuite({
          id: "suite_2",
          name: "Everything nightly",
          slug: "nightly",
          scope: { mode: "folders", folderIds: ["suite_1", "suite_3"] },
        }),
        makeSuite({ id: "suite_3", name: "Refunds", slug: "refunds" }),
      ],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    renderRows(planRowsOf(plans));

    expect(
      within(screen.getByTestId("run-plan-row-checkout")).getByText(
        "All scenarios",
      ),
    ).toBeInTheDocument();
    // A scope over other suites names them rather than counting them.
    expect(
      within(screen.getByTestId("run-plan-row-nightly")).getByText(
        "Checkout, Refunds",
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "The Targets column names the agents the plan runs against" */
  it("names both agents in the Targets cell", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
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
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    const props = renderRows(planRowsOf(plans));

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

  /** @scenario The v2 Test Runs list names the internal set "One-off runs" */
  it("names the internal set One-off runs and marks it as the one-off place", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: {
        passedCount: 1,
        failedCount: 0,
        settledCount: 1,
        lastRunTimestamp: NOW,
      },
    });

    renderRows(planRowsOf(plans));

    const row = screen.getByTestId("run-plan-row-one-off-runs");
    expect(within(row).getByText("One-off runs")).toBeInTheDocument();
    expect(within(row).getByText("one-offs")).toBeInTheDocument();
    // The raw address of the set is never shown.
    expect(screen.queryByText(/__internal__/)).not.toBeInTheDocument();
  });

  /** @scenario "One-off runs has no Edit and no Run of its own" */
  it("offers Open last run but no Edit and no Run on the One-off runs menu", async () => {
    const user = userEvent.setup();
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: {
        passedCount: 1,
        failedCount: 0,
        settledCount: 1,
        lastRunTimestamp: NOW,
      },
    });

    renderRows(planRowsOf(plans));
    await user.click(
      screen.getByRole("button", { name: "Actions for One-off runs" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Open last run" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Edit run plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Run" }),
    ).not.toBeInTheDocument();
  });

  it("lists a set written by code as a run plan of its own", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [],
      suiteSummaries: {},
      externalSets: [makeExternalSet()],
      oneOffLastRun: null,
    });

    renderRows(planRowsOf(plans));

    const row = screen.getByTestId("run-plan-row-external:nightly-ci");
    expect(within(row).getByText("nightly-ci")).toBeInTheDocument();
    expect(within(row).getByText("from code")).toBeInTheDocument();
  });
});

describe("the run plans of a project", () => {
  /** @scenario "One-off runs is listed last, after every test suite and custom run plan" */
  it("lists One-off runs last even when a suite ran more recently", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [
        makeSuite(),
        makeSuite({ id: "suite_2", name: "Refunds", slug: "refunds" }),
      ],
      suiteSummaries: {
        suite_1: {
          passedCount: 3,
          failedCount: 0,
          totalCount: 3,
          lastRunTimestamp: NOW,
        },
      },
      externalSets: [],
      // Older than both suites, and still last.
      oneOffLastRun: {
        passedCount: 1,
        failedCount: 0,
        settledCount: 1,
        lastRunTimestamp: NOW - 10 * 86_400_000,
      },
    });

    expect(plans[plans.length - 1]?.name).toBe("One-off runs");
  });

  /** @scenario "The internal run set is pinned in the run set list" */
  it("holds the internal set in a fixed place next to external sets", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
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
      oneOffLastRun: {
        passedCount: 1,
        failedCount: 0,
        settledCount: 1,
        lastRunTimestamp: NOW - 10 * 86_400_000,
      },
    });

    // The external sets sort by their own run time, a run plan with no run
    // falls below them, and the internal set stays under all of them however
    // recently any of them ran.
    expect(plans.map((plan) => plan.name)).toEqual([
      "ci-regression",
      "smoke-tests",
      "Checkout",
      "One-off runs",
    ]);
  });

  it("keeps the command line's throwaway suites out of the list", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [
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
      oneOffLastRun: null,
    });

    expect(plans.map((plan) => plan.name)).toEqual([
      "Checkout",
      "One-off runs",
    ]);
  });

  /** @scenario "The Scope column says what the plan covers" */
  it("reads a folder as covering the scenarios filed in it", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite({ kind: "folder", scope: null })],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    expect(plans[0]?.scopeLabel).toBe("Scenarios in this suite");
  });

  /** @scenario "The Scope column says what the plan covers" */
  it("reads a hand-picked scope as how many scenarios it holds", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite({ scope: { mode: "cases" } })],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    expect(plans[0]?.scopeLabel).toBe("3 scenarios");
  });

  /** @scenario "The Scope column says what the plan covers" */
  it("reads a label scope as the labels it names", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [
        makeSuite({ scope: { mode: "labels", labels: ["smoke", "critical"] } }),
      ],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    expect(plans[0]?.scopeLabel).toBe("Labelled smoke, critical");
  });
});
