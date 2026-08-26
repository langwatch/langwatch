/**
 * @vitest-environment jsdom
 *
 * Filing a scenario into a test suite: where a new case lands, what the
 * editor offers, what archiving asks, and how a run plan picks cases.
 *
 * @see specs/scenarios/scenario-folder-assignment.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScenarioForm,
  UNFILED_OPTION_LABEL,
} from "~/components/scenarios/ScenarioForm";
import {
  PICKER_UNFILED_GROUP_NAME,
  ScenarioPicker,
} from "~/components/suites/ScenarioPicker";
import { TestCasesTab } from "../cases/TestCasesTab";

const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockFoldersGetAll = vi.hoisted(() => vi.fn());
const mockLastResults = vi.hoisted(() => vi.fn());
const mockArchiveScenario = vi.hoisted(() => vi.fn());
const mockRunScenario = vi.hoisted(() => vi.fn());
const mockRunAll = vi.hoisted(() => vi.fn());
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
const mutation = vi.hoisted(
  () => (mutate: (...args: unknown[]) => void) => () => ({
    mutate,
    isPending: false,
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
      },
      suites: {
        folders: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getAll: { useQuery: mockScenariosGetAll },
      getExternalSetSummaries: { useQuery: emptyQuery },
      getLastResultSummaries: { useQuery: mockLastResults },
      getScenarioSetRunData: { useQuery: emptyQuery },
      archive: { useMutation: mutation(mockArchiveScenario) },
      duplicate: { useMutation: mutation(vi.fn()) },
      moveToFolder: { useMutation: mutation(vi.fn()) },
    },
    suites: {
      folders: {
        getAll: { useQuery: mockFoldersGetAll },
        create: { useMutation: mutation(vi.fn()) },
        rename: { useMutation: mutation(vi.fn()) },
        archive: { useMutation: mutation(vi.fn()) },
      },
      getSummaries: { useQuery: emptyQuery },
      update: { useMutation: mutation(vi.fn()) },
      run: { useMutation: mutation(vi.fn()) },
      runAll: { useMutation: mutation(mockRunAll) },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: { useQuery: emptyQuery },
    },
    agents: { getAll: { useQuery: mockAgentsGetAll } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: mockRunScenario, isRunning: false }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({ hasEnabledProviders: true }),
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

const mockOpenDrawer = vi.hoisted(() => vi.fn());

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, setFlowCallbacks: vi.fn() }),
  useDrawerParams: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    asPath: "/test-project/agent-testing",
    push: mockRouterPush,
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const REFUNDS = {
  id: "suite_refunds",
  name: "Refunds",
  slug: "refunds",
  scenarioIds: ["case_1"],
  caseIds: ["case_1"],
};

function scenarioRow(overrides: Record<string, unknown> = {}) {
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

describe("the Scenarios tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFoldersGetAll.mockReturnValue({ data: [REFUNDS], isLoading: false });
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
   * The URL params the case editor drawer would have been opened with, from
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
      folderId: params.folderId ?? null,
      showHistory: params.showHistory === "true",
    };
  };

  /** @scenario "A project with no scenarios shows what to do first" */
  it("says what a scenario is and offers the first one", () => {
    mockScenariosGetAll.mockReturnValue({ data: [], isLoading: false });
    mockFoldersGetAll.mockReturnValue({ data: [], isLoading: false });
    renderTab();

    const empty = screen.getByTestId("agent-testing-first-case-empty");
    expect(
      within(empty).getByText("Write your first scenario"),
    ).toBeInTheDocument();
    expect(empty).toHaveTextContent(
      /A scenario is one situation you put your agent in/,
    );
    expect(
      within(empty).getByRole("button", { name: "New scenario" }),
    ).toBeInTheDocument();
    expect(caseEditor().open).toBe(false);
  });

  /** @scenario "History opens from the row menu of a scenario" */
  it("opens the case editor with its history already open, from the row menu", async () => {
    const user = userEvent.setup();
    // Loose so the row reads at the root of the All scenarios surface.
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow({ folderId: null })],
      isLoading: false,
    });
    renderTab();

    await user.click(
      screen.getByRole("button", { name: "Actions for Double charge" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "History" }));

    expect(caseEditor()).toEqual({
      open: true,
      scenarioId: "case_1",
      folderId: null,
      showHistory: true,
    });
    expect(mockOpenDrawer).toHaveBeenCalledWith(
      "agentTestingCaseEditor",
      expect.objectContaining({ scenarioId: "case_1", showHistory: "true" }),
    );
  });

  /** @scenario "A case created from inside a suite is filed into that suite" */
  it("files a case made inside a suite into that suite", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId("suite-rail-item-Refunds"));
    await user.click(
      screen.getByRole("button", { name: "Actions for Refunds" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "New scenario" }),
    );

    expect(caseEditor()).toEqual({
      open: true,
      scenarioId: null,
      folderId: REFUNDS.id,
      showHistory: false,
    });
    expect(mockOpenDrawer).toHaveBeenCalledWith(
      "agentTestingCaseEditor",
      expect.objectContaining({ folderId: REFUNDS.id }),
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

  /** @scenario "Archive asks for confirmation and names the case" */
  it("names the case in the archive dialog and archives it on confirm", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow({ folderId: null })],
      isLoading: false,
    });
    renderTab();

    await user.click(
      screen.getByRole("button", { name: "Actions for Double charge" }),
    );
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

  /** @scenario "An unfiled case runs on its own and lands in One-off runs" */
  it("runs an unfiled case on its own without leaving the page", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [scenarioRow({ folderId: null })],
      isLoading: false,
    });
    renderTab();

    await user.click(screen.getByRole("button", { name: "Run Double charge" }));
    const dialog = await screen.findByTestId("run-case-dialog");
    await user.click(within(dialog).getByTestId("run-dialog-agent-agent_1"));
    await user.click(within(dialog).getByTestId("run-dialog-run"));

    // A single case run goes through scenarios.run, which writes into the
    // project's own internal set. That set is what the Test Runs list reads as
    // One-off runs.
    expect(mockRunScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "case_1",
        target: { type: "http", id: "agent_1" },
      }),
    );
    // The page stays where it is; the v1 page is the one that navigates.
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

describe("the case editor", () => {
  afterEach(cleanup);

  /** @scenario "The case editor offers the test suites of the project" */
  it("offers every test suite of the project and an option to file none", () => {
    render(
      <ScenarioForm
        folderOptions={[
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

  it("opens on the suite the case is filed in", () => {
    render(
      <ScenarioForm
        defaultValues={{ folderId: "suite_checkout" }}
        folderOptions={[
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

describe("the case picker of a run plan", () => {
  afterEach(cleanup);

  const pickerProps = (
    overrides: Partial<React.ComponentProps<typeof ScenarioPicker>> = {},
  ): React.ComponentProps<typeof ScenarioPicker> => ({
    scenarios: [
      { id: "case_1", name: "Double charge", labels: [], folderId: "f_1" },
      { id: "case_2", name: "Late refund", labels: [], folderId: "f_1" },
      { id: "case_3", name: "Card declined", labels: [], folderId: "f_2" },
      { id: "case_4", name: "Login flow", labels: [], folderId: "f_2" },
    ],
    selectedIds: [],
    totalCount: 4,
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    searchQuery: "",
    onSearchChange: vi.fn(),
    allLabels: [],
    activeLabelFilter: null,
    onLabelFilterChange: vi.fn(),
    onCreateNew: vi.fn(),
    ...overrides,
  });

  /** @scenario "A custom run plan can select single scenarios grouped by their folder" */
  it("lists the cases under their suite names and saves the ones picked", async () => {
    const user = userEvent.setup();
    const props = pickerProps({
      folders: [
        { id: "f_1", name: "Refunds" },
        { id: "f_2", name: "Checkout" },
      ],
    });
    render(<ScenarioPicker {...props} />, { wrapper: Wrapper });

    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();

    await user.click(screen.getByText("Double charge"));
    await user.click(screen.getByText("Card declined"));

    expect(props.onToggle).toHaveBeenNthCalledWith(1, "case_1");
    expect(props.onToggle).toHaveBeenNthCalledWith(2, "case_3");
  });

  it("keeps the flat list where the project uses no test suite", () => {
    render(<ScenarioPicker {...pickerProps({ folders: [] })} />, {
      wrapper: Wrapper,
    });

    expect(
      screen.queryByText(PICKER_UNFILED_GROUP_NAME),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Double charge")).toBeInTheDocument();
  });
});
