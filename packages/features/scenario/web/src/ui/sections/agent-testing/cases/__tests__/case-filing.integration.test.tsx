/**
 * @vitest-environment jsdom
 *
 * Filing a scenario into a test suite: where a new scenario lands, what the
 * editor offers, what archiving asks, and how a run plan picks scenarios.
 *
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 * @see specs/suites/test-suite-run-plan-reuse.feature
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioForm, UNFILED_OPTION_LABEL } from "../../../../elements/scenario-form";
import { TestCasesTab } from "../test-cases-tab";

const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockTestSuitesGetAll = vi.hoisted(() => vi.fn());
const mockLastResults = vi.hoisted(() => vi.fn());
const mockArchiveScenario = vi.hoisted(() => vi.fn());
const mockRunScenario = vi.hoisted(() => vi.fn());
const mockRunPlan = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockAgentsGetAll = vi.hoisted(() =>
  vi.fn(() => ({
    data: [
      {
        id: "agent_1",
        name: "prod-agent",
        type: "http",
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
  })),
);

const emptyQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
}));
const mutation = vi.hoisted(() => (mutate: (...args: unknown[]) => void) => () => ({
  mutate,
  isPending: false,
}));

vi.mock("../../../../../behavior/scenario-api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
      },
      suites: {
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getAll: { useQuery: mockScenariosGetAll },
      getExternalSetSummaries: { useQuery: emptyQuery },
      getLastResultSummaries: { useQuery: mockLastResults },
      getScenarioSetRunData: { useQuery: emptyQuery },
      getSuiteRunData: { useQuery: emptyQuery },
      getScenarioSetBatchRunCount: { useQuery: emptyQuery },
      archive: { useMutation: mutation(mockArchiveScenario) },
      duplicate: { useMutation: mutation(vi.fn()) },
      moveToTestSuite: { useMutation: mutation(vi.fn()) },
    },
    suites: {
      testSuites: {
        getAll: { useQuery: mockTestSuitesGetAll },
        create: { useMutation: mutation(vi.fn()) },
        rename: { useMutation: mutation(vi.fn()) },
        archive: { useMutation: mutation(vi.fn()) },
      },
      getAll: { useQuery: emptyQuery },
      getSummaries: { useQuery: emptyQuery },
      create: { useMutation: mutation(vi.fn()) },
      update: { useMutation: mutation(vi.fn()) },
      run: { useMutation: mutation(vi.fn()) },
      runPlan: {
        useMutation: () => ({ mutateAsync: mockRunPlan, isPending: false }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: { useQuery: emptyQuery },
    },
    agents: { getAll: { useQuery: mockAgentsGetAll } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("../../../use-run-scenario", () => ({
  useRunScenario: () => ({ runScenario: mockRunScenario, isRunning: false }),
}));

vi.mock("@langwatch/model-provider-web/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({ hasEnabledProviders: true }),
}));

vi.mock("../../../../../behavior/use-can", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

const mockOpenDrawer = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, setFlowCallbacks: vi.fn() }),
  useDrawerParams: () => ({}),
  setFlowCallbacks: vi.fn(),
  getFlowCallbacks: vi.fn(),
  getComplexProps: () => ({}),
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

vi.mock("../../../../../behavior/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    asPath: "/test-project/agent-testing",
    push: mockRouterPush,
    isReady: true,
  }),
}));

// usePeriodSelector reads through the workflows package's own host
// abstraction (WorkflowHostProvider); this surface only needs a stable period
// state, not a real host, so the hook is stubbed directly.
vi.mock("@langwatch/analytics-web/components/PeriodSelector", async (importOriginal) => {
  const mod = await importOriginal<object>();
  return {
    ...mod,
    usePeriodSelector: () => ({
      period: { startDate: new Date("2026-07-01"), endDate: new Date("2026-07-08") },
      mode: "relative" as const,
      setPeriod: vi.fn(),
      setRelativePeriod: vi.fn(),
    }),
  };
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const REFUNDS = {
  id: "suite_refunds",
  name: "Refunds",
  slug: "refunds",
  scenarioIds: ["case_1"],
};

function scenarioRow(overrides: Record<string, unknown> = {}) {
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

describe("the Scenarios tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTestSuitesGetAll.mockReturnValue({ data: [REFUNDS], isLoading: false });
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow()],
      isLoading: false,
    });
    mockLastResults.mockReturnValue({ data: [], isLoading: false });
  });
  afterEach(cleanup);

  const renderTab = () => {
    mockOpenDrawer.mockClear();
    render(<TestCasesTab />, { wrapper: Wrapper });
  };

  /**
   * The URL params the scenario editor drawer would have been opened with, from
   * the last call site, so a test can assert on the target of a click.
   */
  const caseEditor = () => {
    const lastCall = mockOpenDrawer.mock.calls
      .filter(([drawer]) => drawer === "agentTestingCaseEditor")
      .at(-1);
    if (!lastCall) return { open: false };
    const params = (lastCall[1] ?? {}) as Record<string, unknown>;
    return {
      open: true,
      scenarioId: params.scenarioId ?? null,
      testSuiteId: params.testSuiteId ?? null,
      showHistory: params.showHistory === "true",
    };
  };

  /** @scenario "A project with no scenarios shows what to do first" */
  it("says what a scenario is and offers the first one", () => {
    mockScenariosGetAll.mockReturnValue({ data: [], isLoading: false });
    renderTab();

    const empty = screen.getByTestId("agent-testing-first-case-empty");
    expect(within(empty).getByText("Write your first scenario")).toBeInTheDocument();
    expect(empty).toHaveTextContent(/A scenario is one situation you put your agent in/);
    expect(within(empty).getByRole("button", { name: "New scenario" })).toBeInTheDocument();
    expect(caseEditor().open).toBe(false);
  });

  /** @scenario "The row menu of a scenario offers no History item" */
  it("offers no History item, because the versions read inside the editor", async () => {
    const user = userEvent.setup();
    // Loose so the row reads at the root of the All scenarios surface.
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow()],
      isLoading: false,
    });
    renderTab();

    await user.click(screen.getByRole("button", { name: "Actions for Double charge" }));

    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "History" })).not.toBeInTheDocument();
  });

  /** @scenario "A scenario created from inside a suite is filed into that suite" */
  it("files a scenario made inside a suite into that suite", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId("suite-rail-item-Refunds"));
    await user.click(screen.getByRole("button", { name: "Actions for Refunds" }));
    await user.click(await screen.findByRole("menuitem", { name: "New scenario" }));

    expect(caseEditor()).toEqual({
      open: true,
      scenarioId: null,
      testSuiteId: REFUNDS.id,
      showHistory: false,
    });
    expect(mockOpenDrawer).toHaveBeenCalledWith(
      "agentTestingCaseEditor",
      expect.objectContaining({ testSuiteId: REFUNDS.id }),
    );
  });

  /** @scenario "Choosing a suite in the rail does not reload the page" */
  it("pushes the address of a suite shallowly, so the page never reloads", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId("suite-rail-item-Refunds"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.anything(),
      "/test-project/agent-testing/suites/refunds",
      { shallow: true },
    );
  });

  /** @scenario "Archive asks for confirmation and names the scenario" */
  it("names the scenario in the archive dialog and archives it on confirm", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow()],
      isLoading: false,
    });
    renderTab();

    await user.click(screen.getByRole("button", { name: "Actions for Double charge" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Archive scenario?")).toBeInTheDocument();
    expect(within(dialog).getByText("Double charge")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(mockArchiveScenario).toHaveBeenCalledWith({
      projectId: "proj_1",
      id: "case_1",
    });
  });

  /** @scenario "Running one scenario on its own starts a run plan of that scenario and target" */
  it("runs one scenario as a run plan named after the scenario and the agent", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow()],
      isLoading: false,
    });
    mockRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 1,
      suiteId: "plan_double",
      planName: "Double charge prod-agent",
      created: true,
    });
    renderTab();

    await user.click(screen.getByRole("button", { name: "Run Double charge" }));
    const dialog = await screen.findByTestId("run-case-dialog");
    await user.click(within(dialog).getByTestId("run-dialog-agent-agent_1"));
    await user.click(within(dialog).getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockRunPlan).toHaveBeenCalled());
    const sent = mockRunPlan.mock.calls[0]![0] as {
      name: string;
      config: { scope: { mode: string }; scenarioIds?: string[] };
    };
    expect(sent.name).toBe("Double charge prod-agent");
    expect(sent.config.scope).toEqual({ mode: "scenarios" });
    expect(sent.config.scenarioIds).toEqual(["case_1"]);
    // Nothing goes through the scenario runner, so nothing lands in the
    // project's internal run set.
    expect(mockRunScenario).not.toHaveBeenCalled();
    // The page stays where it is; the v1 page is the one that navigates.
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

describe("the scenario editor", () => {
  afterEach(cleanup);

  /** @scenario "The scenario editor offers the test suites of the project" */
  it("offers every test suite of the project and an option to file none", () => {
    render(
      <ScenarioForm
        testSuiteOptions={[
          { id: "suite_refunds", name: "Refunds" },
          { id: "suite_checkout", name: "Checkout" },
        ]}
      />,
      { wrapper: Wrapper },
    );

    const field = screen.getByLabelText("Test suite");
    expect(within(field).getByText("Refunds")).toBeInTheDocument();
    expect(within(field).getByText("Checkout")).toBeInTheDocument();
    expect(within(field).getByText(UNFILED_OPTION_LABEL)).toBeInTheDocument();
  });

  it("opens on the suite the scenario is filed in", () => {
    render(
      <ScenarioForm
        defaultValues={{ testSuiteId: "suite_checkout" }}
        testSuiteOptions={[
          { id: "suite_refunds", name: "Refunds" },
          { id: "suite_checkout", name: "Checkout" },
        ]}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByLabelText("Test suite")).toHaveValue("suite_checkout");
  });

  it("hides the suite field where no suites are offered", () => {
    render(<ScenarioForm />, { wrapper: Wrapper });

    expect(screen.queryByLabelText("Test suite")).not.toBeInTheDocument();
  });
});
