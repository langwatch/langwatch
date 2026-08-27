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
import { LOCKED_IN_ROWS_MESSAGE } from "../run/RunParametersSection";
import { useAgentTestingStore } from "../useAgentTestingStore";

const mockSuitesRunPlan = vi.hoisted(() => vi.fn());
const mockSuitesUpdate = vi.hoisted(() => vi.fn());
const mockRunScenario = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockAgentsGetAll = vi.hoisted(() => vi.fn());
const mockPromptsGetAll = vi.hoisted(() => vi.fn());
const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockFoldersGetAll = vi.hoisted(() => vi.fn());
const mockSuitesGetAll = vi.hoisted(() => vi.fn());
const mockSuitesCreate = vi.hoisted(() => vi.fn());
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
      suites: {
        folders: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
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
      getAll: { useQuery: mockSuitesGetAll },
      getById: { useQuery: emptyQuery },
      create: {
        useMutation: () => ({
          mutateAsync: mockSuitesCreate,
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: mockSuitesUpdate,
          isPending: false,
        }),
      },
      runPlan: {
        useMutation: () => ({
          mutateAsync: mockSuitesRunPlan,
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

/** A scenario that declares the parameters a run may override. */
function casesDeclaring(parameters: unknown) {
  return {
    data: [
      {
        id: "case_1",
        name: "Double charge",
        labels: [],
        folderId: "suite_refunds",
        parameters,
        createdAt: new Date("2026-07-06T12:00:00.000Z"),
        lastUpdatedById: null,
        version: 1,
      },
    ],
    isLoading: false,
  };
}

/**
 * The style the emitted class carries for one element.
 *
 * A dialog lifts the buttons it holds, so a control that must stay flat says
 * so itself. The style lives in a class rather than on the element, and jsdom
 * does not read the emitted sheet, so the rule is read from the sheet by hand.
 */
function styleRuleOf(element: Element): string {
  const className = [...element.classList].find((name) =>
    name.startsWith("css-"),
  );
  const sheets = [...document.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .join("\n");
  return sheets.match(new RegExp(`\\.${className}\\{[^}]*\\}`))?.[0] ?? "";
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
      pendingRun: null,
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
    mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 1,
      suiteId: "plan_1",
      planName: "Refunds prod-agent",
      created: true,
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

  /** @scenario "The agent section offers a way to the agent setup page" */
  it("offers Configure, which opens the agents page in another tab", () => {
    renderDialog(suiteSubject());

    const configure = screen.getByTestId("run-dialog-configure-agents");
    expect(configure).toHaveTextContent("Configure");
    expect(configure).toHaveAttribute("href", "/test-project/agents");
    expect(configure).toHaveAttribute("target", "_blank");
    // The dialog is still the thing on screen.
    expect(screen.getByTestId("run-dialog")).toBeInTheDocument();
  });

  /** @scenario "The agents are shown as blocks with a local tunnel mark" */
  it("shows the agents as blocks, the tunnelled one with a local tunnel mark", () => {
    renderDialog(suiteSubject());

    const tunnelled = screen.getByTestId("run-dialog-agent-agent_1");
    const plain = screen.getByTestId("run-dialog-agent-agent_2");
    expect(within(tunnelled).getByText("prod-agent")).toBeInTheDocument();
    expect(within(plain).getByText("staging-agent")).toBeInTheDocument();
    expect(
      within(tunnelled).getByTestId("agent-dev-tunnel-agent_1"),
    ).toHaveTextContent("Local tunnel");
    expect(
      within(plain).queryByTestId("agent-dev-tunnel-agent_2"),
    ).not.toBeInTheDocument();
    // The block holds the name and the mark, nothing else: no file name, no
    // environment name.
    expect(tunnelled).toHaveTextContent(/^prod-agentLocal tunnel$/);
    expect(plain).toHaveTextContent(/^staging-agent$/);
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
    mockSuitesRunPlan.mockRejectedValue(
      handledRejection("suite_targets_required"),
    );
    const { onClose } = renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-run"));

    const error = await screen.findByTestId("run-dialog-error");
    expect(error).toHaveTextContent("Choose an agent to run against");
    expect(onClose).not.toHaveBeenCalled();
    // The refusal happened before anything was queued.
    expect(mockSuitesRunPlan).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      note: undefined,
    });
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
    // One value field; the checkbox is the secret parameters toggle.
    expect(block.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(
      1,
    );

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
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      parameters: { model: "gpt-5", locale: "de" },
    });
  });

  // --- The parameter block ---

  /** @scenario "The parameter block offers a secret parameters toggle" */
  it("offers a secret parameters toggle that starts off, next to the remove x", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5-mini" }]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));

    const toggle = screen.getByTestId("run-dialog-secret-parameters");
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId("run-dialog-parameter-line")).toBeInTheDocument();
    expect(
      screen.queryByTestId("run-dialog-parameter-rows"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Remove the parameter overrides"),
    ).toBeInTheDocument();
  });

  /** @scenario "Turning the toggle on converts the line into key and value rows" */
  it("keeps every pair of the line when the toggle turns the block into rows", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "model", defaultValue: "gpt-5" },
        { name: "locale", defaultValue: "de" },
      ]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));
    await user.click(screen.getByTestId("run-dialog-secret-parameters"));

    expect(screen.getByTestId("run-dialog-parameter-rows")).toBeInTheDocument();
    expect(
      screen.queryByTestId("run-dialog-parameter-line"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-parameter-name-0")).toHaveValue(
      "model",
    );
    expect(screen.getByTestId("run-dialog-parameter-value-0")).toHaveValue(
      "gpt-5",
    );
    expect(screen.getByTestId("run-dialog-parameter-name-1")).toHaveValue(
      "locale",
    );
    expect(screen.getByTestId("run-dialog-parameter-value-1")).toHaveValue(
      "de",
    );
  });

  /** @scenario "Turning the toggle off writes the rows back onto the line" */
  it("writes the rows back onto the line when the toggle goes off again", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5" }]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));
    await user.click(screen.getByTestId("run-dialog-secret-parameters"));
    await user.type(
      screen.getByTestId("run-dialog-parameter-value-0"),
      "-mini",
    );
    await user.click(screen.getByTestId("run-dialog-secret-parameters"));

    expect(screen.getByTestId("run-dialog-parameter-line")).toHaveValue(
      "model=gpt-5-mini",
    );
  });

  /** @scenario "The quiet controls of the dialog are drawn flat" */
  it("draws the add, the remove and the lock of a row with no shadow", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5" }]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));
    await user.click(screen.getByTestId("run-dialog-secret-parameters"));

    const quiet = [
      screen.getByTestId("run-dialog-parameter-add-row"),
      screen.getByTestId("run-dialog-parameter-remove-0"),
      screen.getByTestId("run-dialog-parameter-lock-0"),
      screen.getByRole("button", { name: "Remove the parameter overrides" }),
    ];
    for (const control of quiet) {
      expect(styleRuleOf(control)).toContain("box-shadow:none");
    }
  });

  /** @scenario "A row can be added and a row can be taken away" */
  it("adds a row, sends both values, and drops the value of a removed row", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5" }]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));
    await user.click(screen.getByTestId("run-dialog-secret-parameters"));
    await user.click(screen.getByTestId("run-dialog-parameter-add-row"));
    await user.type(
      screen.getByTestId("run-dialog-parameter-name-1"),
      "locale",
    );
    await user.type(screen.getByTestId("run-dialog-parameter-value-1"), "de");

    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      parameters: { model: "gpt-5", locale: "de" },
    });

    await user.click(screen.getByTestId("run-dialog-parameter-remove-1"));
    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalledTimes(2));
    expect(mockSuitesRunPlan.mock.calls[1]![0]).toMatchObject({
      parameters: { model: "gpt-5" },
    });
  });

  /** @scenario "A row marked secret is masked and holds the block in rows mode" */
  it("masks a row marked secret and refuses to fold the block back to one line", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5" }]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));
    await user.click(screen.getByTestId("run-dialog-secret-parameters"));
    await user.click(screen.getByTestId("run-dialog-parameter-add-row"));
    await user.type(
      screen.getByTestId("run-dialog-parameter-name-1"),
      "api_token",
    );
    await user.click(screen.getByTestId("run-dialog-parameter-lock-1"));

    const value = screen.getByTestId("run-dialog-parameter-value-1");
    expect(value).toHaveAttribute("type", "password");
    expect(screen.getByTestId("run-dialog-secret-parameters")).toBeDisabled();
    expect(
      screen.getByTestId("run-dialog-secret-parameters-toggle"),
    ).toHaveAttribute("title", LOCKED_IN_ROWS_MESSAGE);
    // The run waits for the value the locked row now demands.
    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();

    await user.type(value, "tok-1");
    expect(screen.getByTestId("run-dialog-run")).toBeEnabled();

    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      parameters: { model: "gpt-5", api_token: "tok-1" },
    });
  });

  /** @scenario "A declared secret parameter is a locked row of the same list" */
  it("shows a declared secret as a locked row of the list and waits for it", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "model", defaultValue: "gpt-5-mini" },
        { name: "api_token", secret: true },
      ]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("customize-chip-params"));

    // The block opens on its rows, and the standalone secret section is gone.
    expect(screen.getByTestId("run-dialog-parameter-rows")).toBeInTheDocument();
    expect(
      screen.queryByTestId("run-dialog-parameter-line"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("suite-run-parameters"),
    ).not.toBeInTheDocument();

    // The plain parameter is a row of the same list.
    expect(screen.getByTestId("run-dialog-parameter-name-0")).toHaveValue(
      "model",
    );

    const toggle = screen.getByTestId("run-dialog-secret-parameters");
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();

    const secret = screen.getByTestId("run-dialog-parameter-value-api_token");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).toHaveValue("");
    expect(secret).toBeRequired();
    expect(
      screen.getByTestId("run-dialog-parameter-lock-api_token"),
    ).toBeDisabled();
    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();

    await user.type(secret, "sk-live-1");
    expect(screen.getByTestId("run-dialog-run")).toBeEnabled();

    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      parameters: { model: "gpt-5-mini", api_token: "sk-live-1" },
    });
  });

  /** @scenario "The chips read in one fixed order" */
  it("reads the chips in one fixed order", () => {
    mockPromptsGetAll.mockReturnValue({
      data: [{ id: "prompt_1", handle: "refund-prompt", version: 3 }],
    });
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5-mini" }]),
    );
    renderDialog(suiteSubject());

    // Every chip carries a plus icon, so the label alone is what is read.
    const chips = within(screen.getByTestId("customize-run-chips"))
      .getAllByRole("button")
      .map((chip) => chip.textContent);
    expect(chips).toEqual([
      "Add parameters",
      "Compare agents",
      "Add a note",
      "Run against a prompt",
      "Custom simulation models",
      "Run multiple times",
    ]);
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

  /** @scenario "The dialog has Cancel and Run, with no dropdown on Run" */
  it("holds Cancel and Run, and Run carries no dropdown", () => {
    renderDialog(suiteSubject({ scenarioIds: ["case_1", "case_2"] }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // Running is what writes the plan down, so there is nothing to save.
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    const run = screen.getByTestId("run-dialog-run");
    expect(run).toHaveTextContent("Run 2 scenarios");
    expect(run).not.toHaveAttribute("aria-haspopup");
    // The count reads on Run alone: the footer states it nowhere else.
    expect(screen.getAllByText(/2 scenarios/)).toHaveLength(1);
  });

  /** @scenario "Confirming a run remembers the target for next time" */
  /** @scenario "The run carries the name the dialog holds" */
  it("sends the name and the whole configuration, and writes no test suite", async () => {
    const user = userEvent.setup();
    const { onRunStarted } = renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      projectId: "proj_1",
      name: "Refunds prod-agent",
      config: {
        scope: { mode: "folders", folderIds: ["suite_refunds"] },
        targets: [{ type: "http", referenceId: "agent_1" }],
        repeatCount: 1,
      },
    });
    // A test suite is only a grouping: no run option is written onto it.
    expect(mockSuitesUpdate).not.toHaveBeenCalled();
    expect(onRunStarted).toHaveBeenCalled();
  });

  /** @scenario "A suite remembers the parameter overrides of its last run" */
  it("opens the parameter block on the overrides the suite remembers", () => {
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "model", defaultValue: "gpt-5-mini" },
        { name: "locale", defaultValue: "de" },
      ]),
    );
    renderDialog(
      suiteSubject({
        initialTarget: { type: "http", id: "agent_1" },
        persistedTarget: {
          type: "http",
          referenceId: "agent_1",
          runParameters: { model: "gpt-5", locale: "nl" },
        },
      }),
    );

    expect(screen.getByTestId("run-dialog-parameters")).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-parameter-line")).toHaveValue(
      "model=gpt-5, locale=nl",
    );
    expect(
      screen.queryByTestId("customize-chip-params"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A suite remembers that it was run against a prompt" */
  it("opens on the prompt picker when the suite was last run against a prompt", () => {
    mockPromptsGetAll.mockReturnValue({
      data: [{ id: "prompt_1", handle: "refund-prompt", version: 3 }],
    });
    renderDialog(
      suiteSubject({
        initialTarget: { type: "prompt", id: "prompt_1" },
        persistedTarget: { type: "prompt", referenceId: "prompt_1" },
      }),
    );

    expect(screen.getByText("Prompt to be tested")).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-prompt-prompt_1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /** @scenario "The run options are remembered for the whole team" */
  it("sends the target and the overrides with the run, where the plan keeps them", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5-mini" }]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));
    await user.click(screen.getByTestId("customize-chip-params"));
    const line = screen.getByTestId("run-dialog-parameter-line");
    await user.clear(line);
    await user.type(line, "model=gpt-5");
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      config: {
        targets: [
          {
            type: "http",
            referenceId: "agent_1",
            runParameters: { model: "gpt-5" },
          },
        ],
      },
    });
  });

  /** @scenario "The note of a run is never remembered" */
  it("never brings a note back, whatever the suite remembers", () => {
    renderDialog(
      suiteSubject({
        initialTarget: { type: "http", id: "agent_1" },
        persistedTarget: { type: "http", referenceId: "agent_1" },
      }),
    );

    expect(screen.queryByTestId("run-note-field")).not.toBeInTheDocument();
    expect(screen.getByTestId("customize-chip-note")).toBeInTheDocument();
  });

  /** @scenario "A secret parameter value is never remembered" */
  it("keeps the secret out of what the plan remembers", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "model", defaultValue: "gpt-5-mini" },
        { name: "api_key", secret: true },
      ]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));
    await user.click(screen.getByTestId("customize-chip-params"));
    await user.type(
      screen.getByTestId("run-dialog-parameter-value-api_key"),
      "sk-live-1",
    );
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    // The run carries the secret; the plan is only told the plain rows.
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      parameters: { api_key: "sk-live-1" },
      config: {
        targets: [
          {
            type: "http",
            referenceId: "agent_1",
            runParameters: { model: "gpt-5-mini" },
          },
        ],
      },
    });
  });

  /** @scenario "A secret row is remembered by its key alone" */
  it("remembers a secret row by its key and never its value", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "model", defaultValue: "gpt-5" }]),
    );
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));
    await user.click(screen.getByTestId("customize-chip-params"));
    await user.click(screen.getByTestId("run-dialog-secret-parameters"));
    await user.click(screen.getByTestId("run-dialog-parameter-add-row"));
    await user.type(
      screen.getByTestId("run-dialog-parameter-name-1"),
      "api_token",
    );
    await user.click(screen.getByTestId("run-dialog-parameter-lock-1"));
    await user.type(
      screen.getByTestId("run-dialog-parameter-value-1"),
      "tok-1",
    );
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      config: {
        targets: [
          {
            type: "http",
            referenceId: "agent_1",
            runParameters: { model: "gpt-5" },
            runSecretParameterNames: ["api_token"],
          },
        ],
      },
    });
    expect(
      JSON.stringify(mockSuitesRunPlan.mock.calls[0]![0]!.config),
    ).not.toContain("tok-1");
  });

  /** @scenario "A secret row is remembered by its key alone" */
  it("opens the remembered secret row empty, in rows mode, and waits for it", () => {
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "model", defaultValue: "gpt-5" },
        { name: "api_token" },
      ]),
    );
    renderDialog(
      suiteSubject({
        initialTarget: { type: "http", id: "agent_1" },
        persistedTarget: {
          type: "http",
          referenceId: "agent_1",
          runParameters: { model: "gpt-5" },
          runSecretParameterNames: ["api_token"],
        },
      }),
    );

    expect(screen.getByTestId("run-dialog-parameter-rows")).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-parameter-name-0")).toHaveValue(
      "model",
    );
    expect(screen.getByTestId("run-dialog-parameter-value-0")).toHaveValue(
      "gpt-5",
    );
    expect(screen.getByTestId("run-dialog-parameter-name-1")).toHaveValue(
      "api_token",
    );
    const secret = screen.getByTestId("run-dialog-parameter-value-1");
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("type", "password");
    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();
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
      "switched judge to the stricter criterion",
    );
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      note: "switched judge to the stricter criterion",
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
    // A disabled solid button turns off its pointer events so hover cannot
    // brighten it, so a click cannot even reach the button. The disabled
    // attribute is the assertion the run cannot start; the never-called
    // mutation confirms it.
    expect(mockSuitesRunPlan).not.toHaveBeenCalled();
  });

  // --- Failure paths ---

  /** @scenario "A parameter value the cases do not declare is refused by name" */
  it("names the unknown parameter and the declared ones in the refusal", async () => {
    const user = userEvent.setup();
    mockSuitesRunPlan.mockRejectedValue(
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
    mockSuitesRunPlan.mockRejectedValue(
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

describe("run entries on the Scenarios tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    useAgentTestingStore.setState({
      lastRunTarget: null,
      pendingRun: null,
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
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 1,
      suiteId: "plan_1",
      planName: "Refunds prod-agent",
      created: true,
    });
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

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    // No navigation: the placeholder is what announces the run. The runs rail
    // renders it from this same store value (see the run plan detail tests).
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(useAgentTestingStore.getState().pendingRun?.batchRunId).toBe(
      "batch_new",
    );
  });
});
