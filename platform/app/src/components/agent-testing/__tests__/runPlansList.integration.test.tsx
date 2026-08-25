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
import type { ExternalSetSummary } from "~/server/scenarios/scenario-event.types";
import { RunPlansTable } from "../results/RunPlansTable";
import {
  buildRunPlans,
  CLI_EPHEMERAL_LABEL,
  type RunPlanSuite,
} from "../results/run-plans";

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

const period = {
  startDate: new Date(NOW - 30 * 86_400_000),
  endDate: new Date(NOW),
};

function renderPlans(
  plans: ReturnType<typeof buildRunPlans>,
  overrides: Partial<React.ComponentProps<typeof RunPlansTable>> = {},
) {
  const props: React.ComponentProps<typeof RunPlansTable> = {
    plans,
    isLoading: false,
    hasAnyPlans: true,
    period,
    periodMode: "relative",
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
    onSelectPlan: vi.fn(),
    onEditPlan: vi.fn(),
    onNewRunPlan: vi.fn(),
    ...overrides,
  };
  render(<RunPlansTable {...props} />, { wrapper: Wrapper });
  return props;
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

    renderPlans(plans);

    expect(screen.getByText("Test Runs")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Nightly plan")).toBeInTheDocument();

    const rows = screen.getAllByTestId(/^run-plan-row-/);
    expect(rows).toHaveLength(4);
    expect(within(rows[3]!).getByText("One-off runs")).toBeInTheDocument();
  });

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

    renderPlans(plans);

    const row = screen.getByTestId("run-plan-row-one-off-runs");
    expect(within(row).getByText("One-off runs")).toBeInTheDocument();
    expect(within(row).getByText("one-offs")).toBeInTheDocument();
    // The raw address of the set is never shown.
    expect(screen.queryByText(/__internal__/)).not.toBeInTheDocument();
  });

  /** @scenario "A run plan row shows its last result" */
  it("carries the pass summary of the last run on the row", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {
        suite_1: {
          passedCount: 3,
          failedCount: 0,
          totalCount: 3,
          lastRunTimestamp: NOW,
        },
      },
      externalSets: [],
      oneOffLastRun: null,
    });

    renderPlans(plans);

    const row = screen.getByTestId("run-plan-row-checkout");
    expect(within(row).getByText("100%")).toBeInTheDocument();
    expect(within(row).getByText("Test suite")).toBeInTheDocument();
    expect(within(row).getByText("2h ago")).toBeInTheDocument();
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

    const props = renderPlans(plans);

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

  /** @scenario "A run plan row shows its last result" */
  it("draws no empty pill on a plan whose summary holds no verdict", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [],
      suiteSummaries: {},
      externalSets: [
        {
          ...makeExternalSet(),
          passedCount: 0,
          failedCount: 0,
          totalCount: 0,
        },
      ],
      oneOffLastRun: null,
    });

    renderPlans(plans);

    const row = screen.getByTestId("run-plan-row-external:nightly-ci");
    expect(
      within(row).queryByTestId("run-metrics-summary"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Choosing a run plan opens its runs" */
  it("opens the plan when its row is chosen", async () => {
    const user = userEvent.setup();
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    const props = renderPlans(plans);
    await user.click(screen.getByText("Checkout"));

    expect(props.onSelectPlan).toHaveBeenCalledWith("checkout");
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

    renderPlans(plans);
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

  it("lists a set written by code as a run plan of its own", () => {
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [],
      suiteSummaries: {},
      externalSets: [makeExternalSet()],
      oneOffLastRun: null,
    });

    renderPlans(plans);

    const row = screen.getByTestId("run-plan-row-external:nightly-ci");
    expect(within(row).getByText("nightly-ci")).toBeInTheDocument();
    expect(within(row).getByText("from code")).toBeInTheDocument();
  });

  /** @scenario "New run plan sits in the header of the Test Runs list" */
  it("offers New run plan in its section header, before the period picker", async () => {
    const user = userEvent.setup();
    const plans = buildRunPlans({
      projectId: PROJECT_ID,
      suites: [makeSuite()],
      suiteSummaries: {},
      externalSets: [],
      oneOffLastRun: null,
    });

    const props = renderPlans(plans);

    const action = screen.getByRole("button", { name: /New run plan/i });
    const picker = screen.getByTestId("results-period-picker");
    expect(
      action.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(action);
    expect(props.onNewRunPlan).toHaveBeenCalledOnce();
  });

  it("says a project with no run has none", () => {
    renderPlans([], { hasAnyPlans: false });

    expect(screen.getByText("No runs yet")).toBeInTheDocument();
  });
});
