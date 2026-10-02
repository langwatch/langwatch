/**
 * @vitest-environment jsdom
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 * @see specs/suites/test-suite-run-plan-reuse.feature
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 * @see specs/features/agent-testing/suites-rail.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { Temporal } from "@langwatch/time";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScenarioForm, UNFILED_OPTION_LABEL } from "../../../../elements/scenario-form.tsx";
import { TestCasesTab } from "../test-cases-tab.tsx";

const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockTestSuitesGetAll = vi.hoisted(() => vi.fn());
const mockLastResults = vi.hoisted(() => vi.fn());
const mockArchiveScenario = vi.hoisted(() => vi.fn());
const mockRunScenario = vi.hoisted(() => vi.fn());
const mockRunPlan = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockCreateSuite = vi.hoisted(() =>
  vi.fn<(input: unknown, options: { onSuccess: () => void }) => void>(),
);
const mockSetTestSuites = vi.hoisted(() =>
  vi.fn<(input: unknown, update: (rows: unknown[] | undefined) => unknown) => void>(),
);
// The create mutation's own onSuccess, so a test decides when the create lands.
const createSuiteHooks = vi.hoisted(() => {
  const hooks: { onSuccess: ((suite: unknown) => void) | null } = { onSuccess: null };
  return hooks;
});
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

vi.mock("../../../../../behavior/scenario-api.ts", () => ({
  api: {
    useUtils: () => ({
      suites: {
        testSuites: { getAll: { invalidate: vi.fn(), setData: mockSetTestSuites } },
        getById: { invalidate: vi.fn() },
      },
    }),
    suites: {
      testSuites: {
        getAll: { useQuery: mockTestSuitesGetAll },
        create: {
          useMutation: (options: { onSuccess: (suite: unknown) => void }) => {
            createSuiteHooks.onSuccess = options.onSuccess;
            return { mutate: mockCreateSuite, isPending: false };
          },
        },
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
  },
}));
vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
    useUtils: () => ({
      suites: {
        testSuites: { getAll: { invalidate: vi.fn(), setData: mockSetTestSuites } },
        getById: { invalidate: vi.fn() },
      },
    }),
    evaluators: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({
      suites: {
        testSuites: { getAll: { invalidate: vi.fn(), setData: mockSetTestSuites } },
        getById: { invalidate: vi.fn() },
      },
    }),
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
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
  },
}));

vi.mock("../../../use-run-scenario.ts", () => ({
  useRunScenario: () => ({ runScenario: mockRunScenario, isRunning: false }),
}));

vi.mock("../../../../../behavior/use-model-providers-settings.ts", () => ({
  useModelProvidersSettings: () => ({ hasEnabledProviders: true }),
}));

vi.mock("../../../../../behavior/use-can.ts", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

const mockOpenDrawer = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, setFlowCallbacks: vi.fn() }),
  useDrawerParams: () => ({}),
  setFlowCallbacks: vi.fn(),
  getFlowCallbacks: vi.fn(),
  getComplexProps: () => ({}),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

// Voice surfaces are flag-gated (release_voice_agents_enabled); this suite is
// not about that gate, so stub the flag on to keep prior behavior.
vi.mock("../../../../../behavior/use-voice-agents-enabled.ts", () => ({
  useVoiceAgentsEnabled: () => true,
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
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
vi.mock("../../../../elements/analytics/period-selector.tsx", async (importOriginal) => {
  const mod = await importOriginal<object>();
  return {
    ...mod,
    usePeriodSelector: () => ({
      period: {
        startDate: Temporal.Instant.from("2026-07-01T00:00:00Z"),
        endDate: Temporal.Instant.from("2026-07-08T00:00:00Z"),
      },
      mode: "relative" as const,
      setPeriod: vi.fn(),
      setRelativePeriod: vi.fn(),
    }),
  };
});

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
    renderWithDesignSystem(<TestCasesTab />);
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

  /** @scenario "A scenario created right after its suite is filed into that new suite" */
  it("keeps the new suite dialog open until the suite lands, then opens it from the answer", async () => {
    const user = userEvent.setup();
    const billing = { id: "suite_billing", name: "Billing", slug: "billing", scenarioIds: [] };
    renderTab();

    await user.click(screen.getByTestId("agent-testing-rail-new-suite"));
    await user.type(screen.getByLabelText("Test suite name"), "Billing");
    await user.click(screen.getByTestId("suite-name-confirm"));

    expect(mockCreateSuite).toHaveBeenCalledWith(
      { projectId: "proj_1", name: "Billing" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // Still open: a New scenario chosen now would be filed in the old suite.
    expect(screen.getByTestId("agent-testing-suite-name-dialog")).toBeInTheDocument();

    act(() => {
      createSuiteHooks.onSuccess?.(billing);
      mockCreateSuite.mock.calls[0]![1].onSuccess();
    });

    const [input, update] = mockSetTestSuites.mock.calls[0]!;
    expect(input).toEqual({ projectId: "proj_1" });
    expect(update([REFUNDS])).toEqual([REFUNDS, billing]);
    expect(mockRouterPush).toHaveBeenCalledWith("/test-project/agent-testing/suites/billing");
    await waitFor(() =>
      expect(screen.queryByTestId("agent-testing-suite-name-dialog")).not.toBeInTheDocument(),
    );
  });

  /** @scenario "Choosing a suite in the rail does not reload the page" */
  it("pushes the real address of a suite, in place, so the page never reloads", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId("suite-rail-item-Refunds"));

    expect(mockRouterPush).toHaveBeenCalledWith("/test-project/agent-testing/suites/refunds");
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
    renderWithDesignSystem(
      <ScenarioForm
        testSuiteOptions={[
          { id: "suite_refunds", name: "Refunds" },
          { id: "suite_checkout", name: "Checkout" },
        ]}
      />,
    );

    const field = screen.getByLabelText("Test suite");
    expect(within(field).getByText("Refunds")).toBeInTheDocument();
    expect(within(field).getByText("Checkout")).toBeInTheDocument();
    expect(within(field).getByText(UNFILED_OPTION_LABEL)).toBeInTheDocument();
  });

  it("opens on the suite the scenario is filed in", () => {
    renderWithDesignSystem(
      <ScenarioForm
        defaultValues={{ testSuiteId: "suite_checkout" }}
        testSuiteOptions={[
          { id: "suite_refunds", name: "Refunds" },
          { id: "suite_checkout", name: "Checkout" },
        ]}
      />,
    );

    expect(screen.getByLabelText("Test suite")).toHaveValue("suite_checkout");
  });

  it("hides the suite field where no suites are offered", () => {
    renderWithDesignSystem(<ScenarioForm />);

    expect(screen.queryByLabelText("Test suite")).not.toBeInTheDocument();
  });
});
