/**
 * @vitest-environment jsdom
 *
 * The run dialog: the agent to be tested, the customize chips, and how a run
 * starts, persists its target, and reads its refusals.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/run-notes.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 * @see specs/features/agent-testing/results-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestCasesTab } from "../cases/TestCasesTab";
import { RunDialog, type RunDialogSubject } from "../run/RunDialog";
import { useAgentTestingStore } from "../useAgentTestingStore";

const mockSuitesRun = vi.hoisted(() => vi.fn());
const mockSuitesRunAll = vi.hoisted(() => vi.fn());
const mockSuitesUpdate = vi.hoisted(() => vi.fn());
const mockRunScenario = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockAgentsGetAll = vi.hoisted(() => vi.fn());
const mockPromptsGetAll = vi.hoisted(() => vi.fn());
const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockFoldersGetAll = vi.hoisted(() => vi.fn());
const mockHasProviders = vi.hoisted(() => ({ value: true }));

const emptyQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
      },
      suites: { folders: { getAll: { invalidate: vi.fn() } } },
    }),
    scenarios: {
      getAll: { useQuery: mockScenariosGetAll },
      getExternalSetSummaries: { useQuery: emptyQuery },
      getLastResultSummaries: { useQuery: emptyQuery },
      getScenarioSetRunData: { useQuery: emptyQuery },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      moveToFolder: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    suites: {
      folders: {
        getAll: { useQuery: mockFoldersGetAll },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        rename: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      getSummaries: { useQuery: emptyQuery },
      update: {
        useMutation: () => ({
          mutateAsync: mockSuitesUpdate,
          isPending: false,
        }),
      },
      run: {
        useMutation: () => ({ mutateAsync: mockSuitesRun, isPending: false }),
      },
      runAll: {
        useMutation: () => ({
          mutateAsync: mockSuitesRunAll,
          isPending: false,
        }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: { useQuery: emptyQuery },
    },
    agents: { getAll: { useQuery: mockAgentsGetAll } },
    prompts: { getAllPromptsForProject: { useQuery: mockPromptsGetAll } },
  },
}));

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: mockRunScenario, isRunning: false }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    hasEnabledProviders: mockHasProviders.value,
  }),
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, setFlowCallbacks: vi.fn() }),
  useDrawerParams: () => ({}),
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

const ONLINE_AGENT = {
  id: "agent_1",
  name: "prod-agent",
  type: "http" as const,
  config: { devTunnel: { url: "http://localhost:1234" } },
};
const OFFLINE_AGENT = {
  id: "agent_2",
  name: "staging-agent",
  type: "http" as const,
  config: {},
};

const suiteSubject = (
  overrides: Partial<Extract<RunDialogSubject, { kind: "suite" }>> = {},
): RunDialogSubject => ({
  kind: "suite",
  suiteId: "suite_refunds",
  name: "Refunds",
  scenarioIds: ["case_1"],
  initialTarget: null,
  ...overrides,
});

const caseSubject = (): RunDialogSubject => ({
  kind: "case",
  scenarioId: "case_1",
  name: "Double charge",
  initialTarget: { type: "http", id: "agent_1" },
});

function renderDialog(subject: RunDialogSubject) {
  const onClose = vi.fn();
  const onRunStarted = vi.fn();
  render(
    <RunDialog
      subject={subject}
      onClose={onClose}
      onRunStarted={onRunStarted}
    />,
    { wrapper: Wrapper },
  );
  return { onClose, onRunStarted };
}

/** A refusal the way tRPC carries a handled error to the client. */
function handledRejection(code: string, meta: Record<string, unknown> = {}) {
  return { data: { error: { code, httpStatus: 422, meta } } };
}

describe("<RunDialog/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    useAgentTestingStore.setState({
      lastRunTarget: null,
      pendingBatchRunId: null,
    });
    mockAgentsGetAll.mockReturnValue({
      data: [ONLINE_AGENT, OFFLINE_AGENT],
    });
    mockPromptsGetAll.mockReturnValue({ data: [] });
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          folderId: "suite_refunds",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    mockFoldersGetAll.mockReturnValue({ data: [], isLoading: false });
    mockSuitesRun.mockResolvedValue({ batchRunId: "batch_new", jobCount: 1 });
    mockSuitesRunAll.mockResolvedValue({
      batchRunId: "batch_all",
      jobCount: 1,
    });
    mockSuitesUpdate.mockResolvedValue({});
  });

  afterEach(cleanup);

  // --- The agent section ---

  /** @scenario "The dialog opens with the agent section and nothing else expanded" */
  it("opens with the agent section, the last target selected, and no field added", () => {
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    expect(screen.getByText("Agent to be tested")).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-agent-agent_1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("customize-run-chips")).toBeInTheDocument();
    expect(screen.queryByTestId("run-note-field")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("run-dialog-parameters"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The agents are shown as blocks with an online mark" */
  it("shows the agents as blocks, the connected one with a green online mark", () => {
    renderDialog(suiteSubject());

    const online = screen.getByTestId("run-dialog-agent-agent_1");
    const offline = screen.getByTestId("run-dialog-agent-agent_2");
    expect(within(online).getByText("prod-agent")).toBeInTheDocument();
    expect(within(offline).getByText("staging-agent")).toBeInTheDocument();
    expect(
      within(online).getByTestId("agent-online-agent_1"),
    ).toHaveTextContent("online");
    expect(
      within(offline).queryByTestId("agent-online-agent_2"),
    ).not.toBeInTheDocument();
    // The block holds the name and the mark, nothing else: no file name, no
    // environment name.
    expect(online).toHaveTextContent(/^prod-agentonline$/);
    expect(offline).toHaveTextContent(/^staging-agent$/);
  });

  /** @scenario "A project with no target shows a Setup agent box" */
  it("shows a dotted Setup agent box when there is nothing to test", async () => {
    const user = userEvent.setup();
    mockAgentsGetAll.mockReturnValue({ data: [] });
    renderDialog(suiteSubject());

    const setup = screen.getByTestId("run-dialog-setup-agent");
    expect(setup).toHaveTextContent("Setup agent");
    await user.click(setup);
    expect(mockOpenDrawer).toHaveBeenCalledWith("agentTypeSelector");
  });

  /** @scenario "A run with no target selected is refused" */
  it("keeps the dialog open and says a target is needed when the run is refused", async () => {
    const user = userEvent.setup();
    mockSuitesRun.mockRejectedValue(handledRejection("suite_targets_required"));
    const { onClose } = renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-run"));

    const error = await screen.findByTestId("run-dialog-error");
    expect(error).toHaveTextContent("Choose an agent to run against");
    expect(onClose).not.toHaveBeenCalled();
    // The refusal happened before anything was queued.
    expect(mockSuitesRun).toHaveBeenCalledTimes(1);
    expect(mockRunScenario).not.toHaveBeenCalled();
  });

  // --- Chips ---

  /** @scenario "The note chip adds a note field" */
  it("adds the note field from its chip and stops offering the chip", async () => {
    const user = userEvent.setup();
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-note"));

    expect(screen.getByTestId("run-note-field")).toBeInTheDocument();
    expect(screen.queryByTestId("customize-chip-note")).not.toBeInTheDocument();
  });

  /** @scenario "A field added by a chip can be removed again" */
  it("removes the note field, offers the chip again, and sends no note", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-note"));
    await user.type(
      screen.getByLabelText("Note for the run"),
      "a note that will be removed",
    );
    await user.click(screen.getByRole("button", { name: "Remove the note" }));

    expect(screen.queryByTestId("run-note-field")).not.toBeInTheDocument();
    expect(screen.getByTestId("customize-chip-note")).toBeInTheDocument();

    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRun).toHaveBeenCalled());
    expect(mockSuitesRun.mock.calls[0]![0]).toMatchObject({ note: undefined });
  });

  /** @scenario "The override parameters chip adds one input line for the values" */
  it("adds exactly one input line, prefilled with the declared values", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          folderId: "suite_refunds",
          parameters: [
            { name: "model", defaultValue: "gpt-5-mini" },
            { name: "locale", defaultValue: "de" },
          ],
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));

    const block = screen.getByTestId("run-dialog-parameters");
    expect(block.querySelectorAll("input")).toHaveLength(1);

    const line = screen.getByTestId("run-dialog-parameter-line");
    expect(line).toHaveValue("model=gpt-5-mini, locale=de");
  });

  /** @scenario "The override parameters chip adds one input line for the values" */
  it("sends what the line holds as the run parameters", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          folderId: "suite_refunds",
          parameters: [{ name: "model", defaultValue: "gpt-5-mini" }],
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));
    const line = screen.getByTestId("run-dialog-parameter-line");
    await user.clear(line);
    await user.type(line, "model=gpt-5, locale=de");

    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRun).toHaveBeenCalled());
    expect(mockSuitesRun.mock.calls[0]![0]).toMatchObject({
      parameters: { model: "gpt-5", locale: "de" },
    });
  });

  /** @scenario "A secret parameter keeps a masked field of its own" */
  it("keeps a secret off the line and waits for its masked field", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          folderId: "suite_refunds",
          parameters: [
            { name: "model", defaultValue: "gpt-5-mini" },
            { name: "api_key", secret: true },
          ],
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));

    expect(screen.getByTestId("run-dialog-parameter-line")).toHaveValue(
      "model=gpt-5-mini",
    );
    const secret = screen.getByTestId("suite-run-parameter-api_key");
    expect(secret).toHaveAttribute("type", "password");
    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();

    await user.type(secret, "sk-live-1");
    expect(screen.getByTestId("run-dialog-run")).toBeEnabled();

    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRun).toHaveBeenCalled());
    expect(mockSuitesRun.mock.calls[0]![0]).toMatchObject({
      parameters: { model: "gpt-5-mini", api_key: "sk-live-1" },
    });
  });

  /** @scenario "The prompt chip replaces the agent area" */
  it("replaces the agent area with the prompt picker, folders included", async () => {
    const user = userEvent.setup();
    mockPromptsGetAll.mockReturnValue({
      data: [
        { id: "prompt_1", handle: "checkout/refund-prompt", version: 3 },
        { id: "prompt_2", handle: "plain-prompt", version: 1 },
      ],
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-prompt"));

    expect(screen.getByText("Prompt to be tested")).toBeInTheDocument();
    expect(screen.queryByTestId("run-dialog-agents")).not.toBeInTheDocument();
    const picker = screen.getByTestId("run-dialog-prompts");
    // The folder of the handle heads its prompts, like the prompt list.
    expect(within(picker).getByText("checkout")).toBeInTheDocument();
    expect(
      within(picker).getByText("checkout/refund-prompt"),
    ).toBeInTheDocument();
    expect(within(picker).getByText("plain-prompt")).toBeInTheDocument();
  });

  /** @scenario "Removing the prompt chip brings the agent area back" */
  it("brings the agent area back with the agent selected before", async () => {
    const user = userEvent.setup();
    mockPromptsGetAll.mockReturnValue({
      data: [{ id: "prompt_1", handle: "checkout/refund-prompt", version: 3 }],
    });
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-prompt"));
    expect(screen.getByText("Prompt to be tested")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Remove the prompt picker" }),
    );

    expect(screen.getByText("Agent to be tested")).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-agent-agent_1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // --- Starting the run ---

  /** @scenario "The dialog has Cancel, Save and Run, with no dropdown on Run" */
  it("holds Cancel, Save and Run, and Run carries no dropdown", () => {
    renderDialog(suiteSubject());

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    const run = screen.getByTestId("run-dialog-run");
    expect(run).toHaveTextContent("Run");
    expect(run).not.toHaveAttribute("aria-haspopup");
  });

  /** @scenario "Confirming a run remembers the target for next time" */
  /** @scenario "The target chosen for a folder run is offered again next time" */
  it("writes the chosen target onto the suite so the next run preselects it", async () => {
    const user = userEvent.setup();
    const { onRunStarted } = renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRun).toHaveBeenCalled());
    expect(mockSuitesUpdate).toHaveBeenCalledWith({
      projectId: "proj_1",
      id: "suite_refunds",
      targets: [{ type: "http", referenceId: "agent_1" }],
    });
    expect(onRunStarted).toHaveBeenCalled();
  });

  /** @scenario "The dialog closes and the person stays where they were" */
  it("closes on confirm without changing the address", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(caseSubject());

    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockRunScenario).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: "case_1" }),
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // --- Notes ---

  /** @scenario "A note typed in the run dialog is stored with the batch" */
  it("sends the typed note with the run", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-note"));
    await user.type(
      screen.getByLabelText("Note for the run"),
      "switched judge to the stricter rubric",
    );
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRun).toHaveBeenCalled());
    expect(mockSuitesRun.mock.calls[0]![0]).toMatchObject({
      note: "switched judge to the stricter rubric",
    });
  });

  /** @scenario "A note over two hundred characters stops the run" */
  /** @scenario "The run dialog refuses a note over two hundred characters before the run starts" */
  it("says a long note is too long and does not start the run", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-note"));
    const field = screen.getByLabelText("Note for the run");
    await user.click(field);
    await user.paste("n".repeat(201));

    expect(screen.getByTestId("run-note-too-long")).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();
    await user.click(screen.getByTestId("run-dialog-run"));
    expect(mockSuitesRun).not.toHaveBeenCalled();
  });

  // --- Failure paths ---

  /** @scenario "A parameter value the cases do not declare is refused by name" */
  it("names the unknown parameter and the declared ones in the refusal", async () => {
    const user = userEvent.setup();
    mockSuitesRun.mockRejectedValue(
      handledRejection("scenario_parameter_unknown", {
        unknownKeys: ["modle"],
        declaredNames: ["model"],
      }),
    );
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("run-dialog-run"));

    const error = await screen.findByTestId("run-dialog-error");
    expect(error).toHaveTextContent(
      "No scenario in this run has a parameter by that name",
    );
    expect(error).toHaveTextContent("modle");
    expect(error).toHaveTextContent("model");
  });

  /** @scenario "A run refused because every case is archived says so in the dialog" */
  it("says there is nothing left to run when every case is archived", async () => {
    const user = userEvent.setup();
    mockSuitesRun.mockRejectedValue(
      handledRejection("suite_all_scenarios_archived"),
    );
    const { onClose } = renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("run-dialog-run"));

    const error = await screen.findByTestId("run-dialog-error");
    expect(error).toHaveTextContent(
      "Every scenario in this run plan is archived",
    );
    expect(error).not.toHaveTextContent(/unknown error/i);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("run entries on the Test cases tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    useAgentTestingStore.setState({
      lastRunTarget: null,
      pendingBatchRunId: null,
    });
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT] });
    mockPromptsGetAll.mockReturnValue({ data: [] });
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          folderId: "suite_refunds",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    mockFoldersGetAll.mockReturnValue({
      data: [
        {
          id: "suite_refunds",
          name: "Refunds",
          slug: "refunds",
          caseIds: ["case_1"],
          targets: [],
        },
      ],
      isLoading: false,
    });
    mockSuitesRun.mockResolvedValue({ batchRunId: "batch_new", jobCount: 1 });
  });

  afterEach(cleanup);

  /** @scenario "Clicking the Run button does not open the row" */
  it("opens the run dialog from the row Run button, not the run drawer", async () => {
    const user = userEvent.setup();
    render(<TestCasesTab />, { wrapper: Wrapper });

    await user.click(screen.getByRole("button", { name: "Run Double charge" }));

    expect(await screen.findByTestId("run-case-dialog")).toBeInTheDocument();
    expect(screen.getByText("Agent to be tested")).toBeInTheDocument();
    expect(mockOpenDrawer).not.toHaveBeenCalled();
  });

  /** @scenario "A run started from the rail appears in the sidebar without a page change" */
  it("starts a suite run from the rail without changing the address, holding a place for it", async () => {
    const user = userEvent.setup();
    render(<TestCasesTab />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("button", { name: "Actions for Refunds" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Run suite" }),
    );

    const dialog = await screen.findByTestId("run-dialog");
    await user.click(within(dialog).getByTestId("run-dialog-agent-agent_1"));
    await user.click(within(dialog).getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRun).toHaveBeenCalled());
    // No navigation: the placeholder is what announces the run. The runs rail
    // renders it from this same store value (see the run plan detail tests).
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(useAgentTestingStore.getState().pendingBatchRunId).toBe("batch_new");
  });
});
