/**
 * @vitest-environment jsdom
 *
 * The toolbar of the Results tab: how the list is grouped, what is cut from
 * it, and the numbers those choices drive.
 *
 * The order on screen is the point. Filters read first, then the stat strip
 * and the chart they move, then the table, so a person sets the question
 * before reading the answer. The charts start closed, and the four groupings
 * sit on screen as connected tabs rather than behind a dropdown.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { useEffect, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsList } from "../results/ResultsList";
import { buildRunPlans, type RunPlanSuite } from "../results/run-plans";
import type { AgentTestingRoutingState } from "../useAgentTestingRouting";

const PROJECT_ID = "proj_1";
const NOW = 1_700_000_000_000;

/**
 * The address, as the page reads and writes it.
 *
 * The grouping and the filters live in the query, so a click that changes
 * either pushes a new address and the page re-reads it. The mock does the same
 * round trip rather than shortcutting to state, which is what lets a test
 * prove the address is what the view follows.
 */
const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string | string[] | undefined>,
  asPath: "/test-project/agent-testing/results",
}));

const rerenderers = vi.hoisted(() => ({ notify: null as null | (() => void) }));

const mockPush = vi.hoisted(() =>
  vi.fn((route: { query: Record<string, string | string[]> }) => {
    routerState.query = { ...route.query };
    rerenderers.notify?.();
  }),
);

/** What the overview read answers, per grouping. */
const overviewState = vi.hoisted(() => ({
  byGroupBy: {} as Record<string, unknown>,
  lastInput: null as Record<string, unknown> | null,
}));

const atomState = vi.hoisted(() => ({
  atoms: [] as unknown[],
  lastInput: null as Record<string, unknown> | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn() },
      },
    }),
    suites: {
      // Every run of the v2 dialog is queued under a plan name.
      runPlan: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
      getSummaries: { useQuery: () => ({ data: {}, isLoading: false }) },
      getById: { useQuery: () => ({ data: undefined }) },
    },
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getAll: {
        useQuery: () => ({
          data: [
            { id: "scen_1", name: "Refund a paid order", labels: ["billing"] },
            { id: "scen_2", name: "Track a parcel", labels: ["support"] },
          ],
        }),
      },
      getResultsOverview: {
        useQuery: (input: Record<string, unknown>) => {
          overviewState.lastInput = input;
          return {
            data: overviewState.byGroupBy[input.groupBy as string],
            isLoading: false,
          };
        },
      },
      getResultAtoms: {
        useQuery: (
          input: Record<string, unknown>,
          options: { enabled: boolean },
        ) => {
          atomState.lastInput = options.enabled ? input : null;
          return {
            data: options.enabled
              ? { atoms: atomState.atoms, hasMore: false }
              : undefined,
            isLoading: false,
          };
        },
      },
      getExternalSetSummaries: { useQuery: () => ({ data: [] }) },
      getScenarioSetBatchHistory: {
        useQuery: () => ({ data: { batches: [] } }),
      },
    },
    agents: {
      getAll: {
        useQuery: () => ({
          data: [
            { id: "agent_dev", name: "dev-agent" },
            { id: "agent_prod", name: "prod-agent" },
          ],
        }),
      },
    },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: PROJECT_ID, slug: "test-project" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: routerState.query,
    asPath: routerState.asPath,
    push: mockPush,
    isReady: true,
  }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({
  formatTimeAgoCompact: () => "2h ago",
}));

const ROUTING_STATE: AgentTestingRoutingState = {
  tab: "results",
  selection: { kind: "suite", slug: null },
  planSlug: null,
  batchRunId: null,
};

function makeSuite(overrides: Partial<RunPlanSuite> = {}): RunPlanSuite {
  return {
    id: "suite_1",
    name: "Checkout",
    slug: "checkout",
    scenarioIds: ["scen_1", "scen_2"],
    labels: [],
    kind: "custom",
    scope: { mode: "cases" },
    ...overrides,
  };
}

function makeTotals(overrides: Record<string, unknown> = {}) {
  return {
    executions: 8,
    runCount: 2,
    passRate: 75,
    failingScenarios: 1,
    cost: { totalUsd: 1.23, knownAtoms: 8, unknownAtoms: 0 },
    series: [
      { label: "6d ago", passRate: 100, isEmpty: false },
      { label: "now", passRate: 75, isEmpty: false },
    ],
    ...overrides,
  };
}

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    key: "checkout",
    title: "Checkout",
    subtitle: null,
    passRate: 75,
    runCount: 2,
    scenarioCount: 2,
    lastRunAt: NOW,
    targetKeys: ["agent_dev"],
    trend: [{ key: "run_1", passRate: 75 }],
    cost: { totalUsd: 1.23, knownAtoms: 8, unknownAtoms: 0 },
    ...overrides,
  };
}

function makeAtom(overrides: Record<string, unknown> = {}) {
  return {
    planSlug: "checkout",
    runId: "batch_1",
    executionId: "exec_1",
    runOrdinal: 1,
    runAt: NOW,
    trigger: "app",
    note: null,
    scenarioId: "scen_1",
    targetKey: "agent_dev",
    status: "SUCCESS",
    outcome: "passed",
    durationMs: 1000,
    costUsd: 0.1,
    costSource: "run",
    ...overrides,
  };
}

/** Re-renders whenever the mock router pushes, the way a real one does. */
function Harness(props: React.ComponentProps<typeof ResultsList>) {
  const [, force] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    rerenderers.notify = force;
    return () => {
      rerenderers.notify = null;
    };
  }, []);
  return <ResultsList {...props} />;
}

const onNewRunPlan = vi.fn();

function renderList() {
  const plans = buildRunPlans({
    suites: [makeSuite()],
    suiteSummaries: {},
    externalSets: [],
  });

  render(
    <ChakraProvider value={defaultSystem}>
      <Harness
        routingState={ROUTING_STATE}
        plans={plans}
        hasAnyPlans={true}
        isPlansLoading={false}
        period={{
          startDate: new Date(NOW - 30 * 86_400_000),
          endDate: new Date(NOW),
        }}
        periodMode="relative"
        setPeriod={vi.fn()}
        setRelativePeriod={vi.fn()}
        onSelectPlan={vi.fn()}
        onSelectRun={vi.fn()}
        onEditPlan={vi.fn()}
        onNewRunPlan={onNewRunPlan}
        isSseConnected={true}
      />
    </ChakraProvider>,
  );
}

describe("the toolbar of the Results tab", () => {
  beforeEach(() => {
    routerState.query = { project: "test-project", path: ["results"] };
    overviewState.byGroupBy = {
      plan: { totals: makeTotals(), groups: [makeGroup()] },
      scenario: { totals: makeTotals(), groups: [] },
      target: { totals: makeTotals(), groups: [] },
      none: { totals: makeTotals(), groups: [] },
    };
    atomState.atoms = [];
    atomState.lastInput = null;
    overviewState.lastInput = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** @scenario "New run plan sits in the header of the Test Runs list" */
  it("offers New run plan in the header of the list", async () => {
    const user = userEvent.setup();
    renderList();

    const button = screen.getByRole("button", { name: /new run plan/i });
    await user.click(button);

    expect(onNewRunPlan).toHaveBeenCalled();
  });

  describe("when the top of the tab is read", () => {
    // The three blocks are found by their own test ids and compared by
    // document order, so a toolbar that put the numbers first would fail
    // rather than pass on the order the assertions happen to be written in.
    /** @scenario "The toolbar puts the filters above the numbers they drive" */
    it("reads the filter row, then the charts, then the table", async () => {
      const user = userEvent.setup();
      renderList();

      await user.click(screen.getByTestId("results-charts-toggle"));

      const filters = screen.getByTestId("agent-testing-results-filter-row");
      const charts = screen.getByTestId("agent-testing-results-charts");
      const table = screen.getByTestId("agent-testing-run-plans-table");

      expect(
        filters.compareDocumentPosition(charts) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        charts.compareDocumentPosition(table) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario "The filter row holds four filters, the period and the Charts toggle" */
    it("holds the four filters, the period picker and the Charts toggle", () => {
      renderList();

      const row = screen.getByTestId("agent-testing-results-filter-row");
      expect(
        within(row).getByRole("button", { name: /scenario/i }),
      ).toBeInTheDocument();
      expect(
        within(row).getByRole("button", { name: /label/i }),
      ).toBeInTheDocument();
      expect(
        within(row).getByRole("button", { name: /target/i }),
      ).toBeInTheDocument();
      expect(
        within(row).getByTestId("results-filter-status"),
      ).toBeInTheDocument();
      expect(
        within(row).getByTestId("results-period-picker"),
      ).toBeInTheDocument();

      // An on and off control, so the pressed state is the only signal it
      // needs. A caret would promise a menu that is not there.
      const toggle = within(row).getByTestId("results-charts-toggle");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle.querySelector("svg.lucide-chevron-down")).toBeNull();
    });

    /** @scenario "The charts block is hidden until the Charts toggle is used" */
    it("keeps the stat strip and the chart closed until Charts is chosen", async () => {
      const user = userEvent.setup();
      renderList();

      expect(
        screen.queryByTestId("agent-testing-results-charts"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("results-pass-rate-chart"),
      ).not.toBeInTheDocument();

      await user.click(screen.getByTestId("results-charts-toggle"));

      expect(screen.getByTestId("results-stat-pass-rate")).toHaveTextContent(
        "75%",
      );
      expect(screen.getByTestId("results-pass-rate-chart")).toBeInTheDocument();
    });

    /** @scenario "There is no Simple and Explorer switch" */
    it("offers no switch between a simple view and an explorer view", () => {
      renderList();

      expect(screen.queryByText(/simple/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/explorer/i)).not.toBeInTheDocument();
    });
  });

  describe("when the Group by control is read", () => {
    /** @scenario "Group by is an enclosed segmented control of four tabs" */
    it("draws four connected tabs in one enclosure, not a dropdown", () => {
      renderList();

      const control = screen.getByTestId("results-group-by");
      const tabs = within(control).getAllByRole("radio");

      expect(tabs).toHaveLength(4);
      expect(control).toHaveTextContent("Run plan");
      expect(control).toHaveTextContent("Scenario");
      expect(control).toHaveTextContent("Target");
      expect(control).toHaveTextContent("None");

      // All four are inside the one enclosure rather than behind a trigger.
      for (const tab of tabs) expect(control).toContainElement(tab);
      expect(within(control).queryByRole("combobox")).toBeNull();

      // Run plan is the grouping the tab opens on.
      expect(
        screen.getByTestId("agent-testing-run-plans-table"),
      ).toBeInTheDocument();
    });
  });

  describe("when a filter is chosen", () => {
    // The read is asked for the narrowed scope, and the rows and the numbers
    // both come from what it answers, so one filter cannot move the table
    // without moving the stat strip.
    /** @scenario "A filter cuts the list and every number with it" */
    it("narrows the read that both the table and the numbers come from", async () => {
      const user = userEvent.setup();
      renderList();

      await user.click(screen.getByTestId("results-charts-toggle"));
      expect(screen.getByTestId("results-stat-executions")).toHaveTextContent(
        "8",
      );

      overviewState.byGroupBy.plan = {
        totals: makeTotals({ executions: 3, passRate: 33 }),
        groups: [makeGroup({ passRate: 33 })],
      };

      await user.click(screen.getByRole("button", { name: /scenario/i }));
      await user.click(
        await screen.findByRole("menuitemcheckbox", {
          name: /refund a paid order/i,
        }),
      );

      expect(routerState.query.scenarios).toBe("scen_1");
      expect(overviewState.lastInput?.scenarioIds).toEqual(["scen_1"]);
      expect(screen.getByTestId("results-stat-executions")).toHaveTextContent(
        "3",
      );
      expect(
        within(screen.getByTestId("run-plan-row-checkout")).getByTestId(
          "pass-rate-text",
        ),
      ).toHaveTextContent("33%");
    });
  });

  describe("when another grouping is chosen", () => {
    /** @scenario "Grouping by scenario opens a row for every run of that scenario" */
    it("lists a scenario once and opens it onto every run of it", async () => {
      const user = userEvent.setup();
      overviewState.byGroupBy.scenario = {
        totals: makeTotals(),
        groups: [
          makeGroup({
            key: "scen_1",
            title: "Refund a paid order",
            subtitle: "billing",
            trend: [
              { key: "exec_1", passRate: 100 },
              { key: "exec_2", passRate: 0 },
            ],
          }),
        ],
      };
      // The same scenario, run once under each of two plans. One row must
      // cover both, which is what the grouping is for.
      atomState.atoms = [
        makeAtom({ executionId: "exec_1", planSlug: "checkout" }),
        makeAtom({
          executionId: "exec_2",
          planSlug: "nightly",
          runId: "batch_2",
          outcome: "failed",
        }),
      ];

      renderList();

      await user.click(screen.getByRole("radio", { name: "Scenario" }));

      expect(routerState.query.groupBy).toBe("scenario");
      const row = await screen.findByTestId("results-group-row-scen_1");
      expect(row).toHaveTextContent("Refund a paid order");
      expect(within(row).getAllByTestId("trend-sparkline-bar")).toHaveLength(2);

      await user.click(row);

      const opened = await screen.findByTestId("results-group-expanded-scen_1");
      expect(
        within(opened).getByTestId("results-run-line-exec_1"),
      ).toBeInTheDocument();
      expect(
        within(opened).getByTestId("results-run-line-exec_2"),
      ).toBeInTheDocument();
      expect(atomState.lastInput?.scenarioIds).toEqual(["scen_1"]);
    });

    // dev is fed second and prod first, so a table that only preserved the
    // order it was handed could not pass by reading them back in the order
    // the assertion names.
    /** @scenario "Grouping by target compares one agent against another" */
    it("lists one row per target, each reading that target alone", async () => {
      const user = userEvent.setup();
      overviewState.byGroupBy.target = {
        totals: makeTotals(),
        groups: [
          makeGroup({
            key: "agent_prod",
            title: "prod-agent",
            passRate: 100,
            scenarioCount: 2,
          }),
          makeGroup({
            key: "agent_dev",
            title: "dev-agent",
            passRate: 25,
            scenarioCount: 2,
          }),
        ],
      };

      renderList();

      await user.click(screen.getByRole("radio", { name: "Target" }));

      const dev = await screen.findByTestId("results-group-row-agent_dev");
      const prod = screen.getByTestId("results-group-row-agent_prod");

      expect(dev).toHaveTextContent("dev-agent");
      expect(prod).toHaveTextContent("prod-agent");
      expect(within(dev).getByTestId("pass-rate-text")).toHaveTextContent(
        "25%",
      );
      expect(within(prod).getByTestId("pass-rate-text")).toHaveTextContent(
        "100%",
      );
    });

    /** @scenario "Grouping by none reads the flat list" */
    it("lists one row per scenario, target and run", async () => {
      const user = userEvent.setup();
      atomState.atoms = [
        makeAtom({ executionId: "exec_1", scenarioId: "scen_1" }),
        makeAtom({
          executionId: "exec_2",
          scenarioId: "scen_2",
          targetKey: "agent_prod",
        }),
      ];

      renderList();

      await user.click(screen.getByRole("radio", { name: "None" }));

      expect(routerState.query.groupBy).toBe("none");
      const table = await screen.findByTestId("agent-testing-results-flat");
      expect(
        within(table).getByTestId("results-flat-row-exec_1"),
      ).toHaveTextContent("Refund a paid order");
      expect(
        within(table).getByTestId("results-flat-row-exec_2"),
      ).toHaveTextContent("Track a parcel");
      expect(
        within(table).getByTestId("results-flat-row-exec_2"),
      ).toHaveTextContent("prod-agent");
    });
  });
});
