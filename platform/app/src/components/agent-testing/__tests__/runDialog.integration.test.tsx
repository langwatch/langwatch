/**
 * @vitest-environment jsdom
 *
 * The run dialog: the agent to be tested, the customize chips, and how a run
 * starts, persists its target, and reads its refusals.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 * @see specs/suites/run-notes.feature
 * @see specs/suites/test-suite-run-plan-reuse.feature
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
import { COMPARE_HINT } from "../run/CompareAgentsSection";
import { DUPLICATE_TARGETS_MESSAGE } from "../run/compare-rows";
import { RunDialog, type RunDialogSubject } from "../run/RunDialog";
import { LOCKED_IN_ROWS_MESSAGE } from "../run/RunParametersSection";
import { configurationKeyOf } from "../run/run-configuration";
import { targetColor } from "../shared/target-colors";
import { useAgentTestingStore } from "../useAgentTestingStore";

const mockSuitesRunPlan = vi.hoisted(() => vi.fn());
const mockSuitesUpdate = vi.hoisted(() => vi.fn());
const mockRunScenario = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockAgentsGetAll = vi.hoisted(() => vi.fn());
const mockPromptsGetAll = vi.hoisted(() => vi.fn());
const mockScenariosGetAll = vi.hoisted(() => vi.fn());
const mockTestSuitesGetAll = vi.hoisted(() => vi.fn());
const mockSuitesGetAll = vi.hoisted(() => vi.fn());
const mockRunConfigurations = vi.hoisted(() => vi.fn());
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
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getAll: { useQuery: mockScenariosGetAll },
      getExternalSetSummaries: { useQuery: emptyQuery },
      getLastResultSummaries: { useQuery: emptyQuery },
      getScenarioSetRunData: { useQuery: emptyQuery },
      getRunConfigurations: { useQuery: mockRunConfigurations },
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      moveToTestSuite: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    suites: {
      testSuites: {
        getAll: { useQuery: mockTestSuitesGetAll },
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
    modelProvider: {
      listAllForProjectForFrontend: { useQuery: emptyQuery },
      getResolvedDefault: { useQuery: emptyQuery },
    },
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
        testSuiteId: "suite_refunds",
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
          testSuiteId: "suite_refunds",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    mockTestSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockRunConfigurations.mockReturnValue({ data: [], isLoading: false });
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
    // The words carry the link, so no icon trails them.
    expect(configure.querySelector("svg")).toBeNull();
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

  /** @scenario "The parameters chip adds one input line for the values" */
  it("adds exactly one input line, prefilled with the declared values", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          testSuiteId: "suite_refunds",
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

  /** @scenario "The parameters chip adds one input line for the values" */
  it("sends what the line holds as the run parameters", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          testSuiteId: "suite_refunds",
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
  it("replaces the agent area with the prompt picker, test suites included", async () => {
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
    // The test suite of the handle heads its prompts, like the prompt list.
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
        scope: { mode: "test_suites", testSuiteIds: ["suite_refunds"] },
        targets: [{ type: "http", referenceId: "agent_1" }],
        repeatCount: 1,
      },
    });
    // A test suite is only a grouping: no run option is written onto it.
    expect(mockSuitesUpdate).not.toHaveBeenCalled();
    expect(onRunStarted).toHaveBeenCalled();
  });

  /** @scenario "A suite remembers the parameter overrides of its last run" */
  it("opens the parameter block on the overrides the newest run plan used", async () => {
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "model", defaultValue: "gpt-5-mini" },
        { name: "locale", defaultValue: "de" },
      ]),
    );
    // The suite row carries nothing: the memory is the newest run plan of the
    // scope, which the dialog reads.
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({ runParameters: { model: "gpt-5", locale: "nl" } }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    expect(
      await screen.findByTestId("run-dialog-parameters"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-parameter-line")).toHaveValue(
      "model=gpt-5, locale=nl",
    );
    expect(screen.getByTestId("run-dialog-agent-agent_1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByTestId("customize-chip-params"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A suite remembers that it was run against a prompt" */
  it("opens on the prompt picker when the newest run plan ran against a prompt", async () => {
    mockPromptsGetAll.mockReturnValue({
      data: [{ id: "prompt_1", handle: "refund-prompt", version: 3 }],
    });
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({
          targets: [{ type: "prompt", referenceId: "prompt_1" }],
        }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    expect(await screen.findByText("Prompt to be tested")).toBeInTheDocument();
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
  it("never brings a note back, whatever the run plan remembers", async () => {
    mockRunConfigurations.mockReturnValue({
      data: [configurationEntry({ usesNote: false })],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await waitFor(() =>
      expect(screen.getByTestId("run-dialog-agent-agent_1")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
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
  it("opens the remembered secret row empty, in rows mode, and waits for it", async () => {
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "model", defaultValue: "gpt-5" },
        { name: "api_token" },
      ]),
    );
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({
          targets: [
            {
              type: "http",
              referenceId: "agent_1",
              runSecretParameterNames: ["api_token"],
            },
          ],
          runParameters: { model: "gpt-5" },
        }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    expect(
      await screen.findByTestId("run-dialog-parameter-rows"),
    ).toBeInTheDocument();
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
    // A run of one scenario is an ordinary plan run, so it goes out the same
    // way every other entry point does.
    expect(mockSuitesRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ scenarioIds: ["case_1"] }),
      }),
    );
    expect(mockRunScenario).not.toHaveBeenCalled();
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

  /** @scenario "A parameter value the scenarios do not declare is refused by name" */
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

  /** @scenario "A run refused because every scenario is archived says so in the dialog" */
  it("says there is nothing left to run when every scenario is archived", async () => {
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
          testSuiteId: "suite_refunds",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    mockTestSuitesGetAll.mockReturnValue({
      data: [
        {
          id: "suite_refunds",
          name: "Refunds",
          slug: "refunds",
          scenarioIds: ["case_1"],
          targets: [],
        },
      ],
      isLoading: false,
    });
    mockRunConfigurations.mockReturnValue({ data: [], isLoading: false });
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 1,
      suiteId: "plan_1",
      planName: "Refunds prod-agent",
      created: true,
    });
  });

  afterEach(cleanup);

  /** @scenario "A suite run from the Scenarios tab opens on its newest run plan" */
  it("preselects the agent of the newest run plan of the suite", async () => {
    const user = userEvent.setup();
    // The rail row carries no run option, so the preselection can only come
    // from the run plans of the scope. The project holds one test suite, so
    // that scope folds to every scenario, which is what the run plan of this
    // suite was written under.
    mockRunConfigurations.mockReturnValue({
      data: [configurationEntry({ scope: { mode: "all" } })],
      isLoading: false,
    });
    render(<TestCasesTab />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("button", { name: "Actions for Refunds" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Run suite" }),
    );

    const dialog = await screen.findByTestId("run-dialog");
    await waitFor(() =>
      expect(
        within(dialog).getByTestId("run-dialog-agent-agent_1"),
      ).toHaveAttribute("aria-pressed", "true"),
    );
  });

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

/** One configuration, in the shape the run configurations read returns it. */
function configurationEntry(
  overrides: {
    planId?: string;
    planName?: string;
    targets?: {
      type: string;
      referenceId: string;
      runParameters?: Record<string, string>;
      runSecretParameterNames?: string[];
    }[];
    repeatCount?: number;
    runParameters?: Record<string, string>;
    lastRunAt?: Date;
    scope?: unknown;
    usesNote?: boolean;
  } = {},
) {
  const configuration = {
    scope: overrides.scope ?? {
      mode: "test_suites",
      testSuiteIds: ["suite_refunds"],
    },
    targets: overrides.targets ?? [{ type: "http", referenceId: "agent_1" }],
    repeatCount: overrides.repeatCount ?? 1,
    simulatorModel: null,
    judgeModel: null,
  };
  const runParameters = overrides.runParameters ?? {};
  return {
    // The key is the configuration's identity, taken the way the server takes
    // it, so two entries of one plan that differ in parameters or repeat count
    // are two rows.
    key: configurationKeyOf({
      configuration: configuration as never,
      runParameters,
    }),
    planId: overrides.planId ?? "plan_1",
    planName: overrides.planName ?? "Refunds prod-agent",
    configuration,
    runParameters,
    usesNote: overrides.usesNote ?? false,
    lastRunAt: overrides.lastRunAt ?? new Date("2026-08-01T10:00:00.000Z"),
  };
}

describe("the run name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    useAgentTestingStore.setState({ lastRunTarget: null, pendingRun: null });
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT, OFFLINE_AGENT] });
    mockPromptsGetAll.mockReturnValue({ data: [] });
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: ["billing"],
          testSuiteId: "suite_refunds",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    mockTestSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockRunConfigurations.mockReturnValue({ data: [], isLoading: false });
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 1,
      suiteId: "plan_1",
      planName: "Refunds prod-agent",
      created: true,
    });
  });

  afterEach(cleanup);

  /** @scenario "The run name is the first field and holds the derived name" */
  it("reads first, holds the derived name, and explains nothing under it", () => {
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    const name = screen.getByTestId("run-dialog-name");
    expect(name).toHaveValue("Refunds prod-agent");

    // The name comes before the agent section, not after it.
    const agentLabel = screen.getByText("Agent to be tested");
    expect(
      name.compareDocumentPosition(agentLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The block holds the label and the field, and explains nothing.
    expect(screen.getByTestId("run-dialog-name-block")).toHaveTextContent(
      /^Run name$/,
    );
  });

  /** @scenario "The derived name follows the agent until the person types" */
  it("follows the agent, and stops the moment a name is typed", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("run-dialog-agent-agent_2"));
    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Refunds staging-agent",
    );

    await user.clear(screen.getByTestId("run-dialog-name"));
    await user.type(screen.getByTestId("run-dialog-name"), "Nightly refunds");
    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));

    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Nightly refunds",
    );
  });

  /** @scenario "A comparison run derives both targets into the name" */
  it("reads both agents of a comparison, joined by vs, in the plan's order", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_2" } }),
    );

    await user.click(screen.getByTestId("customize-chip-compare"));

    // The second row defaulted to the other agent, and the name reads the
    // targets the way the run plan sorts them rather than the row order.
    expect(screen.getByTestId("run-dialog-compare-agent-1")).toHaveValue(
      "agent_1",
    );
    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Refunds prod-agent vs staging-agent",
    );
  });

  /** @scenario "The name field lists the configurations this scope ran with before" */
  it("lists the configurations of this scope newest first, each saying what it ran with", async () => {
    const user = userEvent.setup();
    // Fed oldest first, so an order that is merely preserved fails here.
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({
          planId: "plan_old",
          planName: "Refunds prod-agent",
          lastRunAt: new Date("2026-08-01T10:00:00.000Z"),
        }),
        configurationEntry({
          planId: "plan_new",
          planName: "Nightly refunds",
          targets: [{ type: "http", referenceId: "agent_2" }],
          lastRunAt: new Date("2026-08-20T10:00:00.000Z"),
        }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-name-caret"));

    const options = within(
      await screen.findByTestId("run-dialog-name-options"),
    ).getAllByRole("button");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Nightly refunds"),
      expect.stringContaining("Refunds prod-agent"),
    ]);
    // Each row says what it goes against, which is what tells them apart.
    expect(options[0]).toHaveTextContent("staging-agent");
    expect(options[1]).toHaveTextContent("prod-agent");
  });

  /** @scenario "A scope with no history offers a plain field" */
  it("offers a plain field with no caret when the scope never ran", () => {
    renderDialog(suiteSubject());

    expect(screen.getByTestId("run-dialog-name")).toBeInTheDocument();
    expect(
      screen.queryByTestId("run-dialog-name-caret"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The note text is never carried over" */
  /** @scenario "A run plan that takes a note opens the note field ready" */
  it("opens the note block ready and empty, and carries no note text", async () => {
    const user = userEvent.setup();
    mockRunConfigurations.mockReturnValue({
      data: [
        // The read carries the fact, never the text. The text below stands in
        // for a note leaking onto an entry: it must reach neither the list nor
        // the field.
        {
          ...configurationEntry({ usesNote: true }),
          note: "checking the stricter criterion",
        },
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-name-caret"));
    const list = await screen.findByTestId("run-dialog-name-options");
    expect(list).not.toHaveTextContent("stricter criterion");

    await user.click(within(list).getAllByRole("button")[0]!);

    // The plan takes a note, so the block is ready for one.
    const note = screen.getByTestId("run-note-field");
    expect(within(note).getByRole("textbox")).toHaveValue("");
    expect(note).not.toHaveTextContent("stricter criterion");
    expect(screen.queryByTestId("customize-chip-note")).not.toBeInTheDocument();
  });

  /** @scenario "A field added by a chip can be removed again" */
  it("leaves the note block folded away for a plan that never took one", async () => {
    const user = userEvent.setup();
    mockRunConfigurations.mockReturnValue({
      data: [configurationEntry({ usesNote: false })],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-name-caret"));
    await user.click(
      within(await screen.findByTestId("run-dialog-name-options")).getAllByRole(
        "button",
      )[0]!,
    );

    expect(screen.queryByTestId("run-note-field")).not.toBeInTheDocument();
    expect(screen.getByTestId("customize-chip-note")).toBeInTheDocument();
  });

  /** @scenario "Picking a configuration refills the dialog and opens what it used" */
  it("refills the dialog, opens the blocks that entry used, and pins the name", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "locale", defaultValue: "en" }]),
    );
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({
          planName: "Nightly refunds",
          repeatCount: 3,
          targets: [
            { type: "http", referenceId: "agent_1" },
            { type: "http", referenceId: "agent_2" },
          ],
          runParameters: { locale: "de" },
        }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-name-caret"));
    await user.click(
      within(await screen.findByTestId("run-dialog-name-options")).getAllByRole(
        "button",
      )[0]!,
    );

    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Nightly refunds",
    );
    expect(screen.getByTestId("run-dialog-compare")).toBeInTheDocument();
    expect(screen.getByLabelText("Repeat count")).toHaveValue(3);
    // A configuration stored with its overrides at run level puts them on
    // every row, which is what that run did with them.
    expect(screen.getByTestId("run-dialog-compare-parameters-0")).toHaveValue(
      "locale=de",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-1")).toHaveValue(
      "locale=de",
    );
    expect(
      screen.queryByTestId("run-dialog-parameter-line"),
    ).not.toBeInTheDocument();
    // The name was taken over, so it no longer follows the agent.
    await user.selectOptions(
      screen.getByTestId("run-dialog-compare-agent-0"),
      "agent_2",
    );
    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Nightly refunds",
    );
  });

  /** @scenario "Typing filters the list and opens it" */
  it("narrows the list to what is typed, and offers none for a new name", async () => {
    const user = userEvent.setup();
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({
          planId: "plan_a",
          planName: "Refunds prod-agent",
        }),
        configurationEntry({
          planId: "plan_b",
          planName: "Nightly refunds",
          targets: [{ type: "http", referenceId: "agent_2" }],
        }),
        configurationEntry({
          planId: "plan_c",
          planName: "Weekly refunds",
          repeatCount: 2,
        }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    const field = screen.getByTestId("run-dialog-name");
    await user.clear(field);
    await user.type(field, "Nightly");

    const shown = within(
      await screen.findByTestId("run-dialog-name-options"),
    ).getAllByRole("button");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveTextContent("Nightly refunds");

    await user.clear(field);
    await user.type(field, "Something else entirely");
    await waitFor(() =>
      expect(
        screen.queryByTestId("run-dialog-name-options"),
      ).not.toBeInTheDocument(),
    );
  });

  /** @scenario "The arrow keys move and Enter takes the highlighted entry" */
  it("moves down the list and takes the highlighted entry on Enter", async () => {
    const user = userEvent.setup();
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({
          planId: "plan_new",
          planName: "Nightly refunds",
          targets: [{ type: "http", referenceId: "agent_2" }],
          lastRunAt: new Date("2026-08-20T10:00:00.000Z"),
        }),
        configurationEntry({
          planId: "plan_old",
          planName: "Refunds prod-agent",
          lastRunAt: new Date("2026-08-01T10:00:00.000Z"),
        }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-name-caret"));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    // The second row, not the first: the arrows moved off the top of the list.
    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Refunds prod-agent",
    );
  });

  /** @scenario "Escape closes the list and leaves the dialog open" */
  it("closes the list on Escape and asks for no dialog close", async () => {
    const user = userEvent.setup();
    mockRunConfigurations.mockReturnValue({
      data: [configurationEntry()],
      isLoading: false,
    });
    const { onClose } = renderDialog(suiteSubject());

    // Opened from the caret, which is where the key lands: the caret took the
    // focus off the field.
    await user.click(screen.getByTestId("run-dialog-name-caret"));
    expect(
      await screen.findByTestId("run-dialog-name-options"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByTestId("run-dialog-name-options"),
      ).not.toBeInTheDocument(),
    );
    // The subject is what mounts the dialog, so its presence proves nothing:
    // the close the dialog would ask its caller for is what must not happen.
    expect(onClose).not.toHaveBeenCalled();

    // A second Escape, with the list closed, does close the dialog.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  /** @scenario "A run with no name cannot start" */
  it("keeps Run off while the name is empty", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.clear(screen.getByTestId("run-dialog-name"));

    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();
  });

  /** @scenario "A stored run plan opens on the name it is stored under" */
  it("opens a stored run plan on its stored name, naming the agent once", () => {
    renderDialog(
      suiteSubject({
        suiteId: "plan_1",
        name: "Refunds prod-agent",
        planName: "Refunds prod-agent",
        initialTarget: { type: "http", id: "agent_1" },
      }),
    );

    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Refunds prod-agent",
    );
  });

  /** @scenario "A stored run plan that took a note opens the note field ready" */
  it("opens the note block of a stored plan whose last run took a note", async () => {
    mockRunConfigurations.mockReturnValue({
      data: [
        // The read carries the fact, never the text. The text below stands in
        // for a note leaking onto an entry: it must reach no field.
        {
          ...configurationEntry({ planId: "plan_1", usesNote: true }),
          note: "checking the stricter criterion",
        },
      ],
      isLoading: false,
    });

    renderDialog(
      suiteSubject({
        suiteId: "plan_1",
        name: "Refunds prod-agent",
        planName: "Refunds prod-agent",
        scope: { mode: "test_suites", testSuiteIds: ["suite_refunds"] },
        initialTarget: { type: "http", id: "agent_1" },
        // The plan carries its own remembered target, which is what used to
        // stop the dialog reading the history at all.
        persistedTarget: { type: "http", referenceId: "agent_1" },
      }),
    );

    const note = await screen.findByTestId("run-note-field");
    expect(within(note).getByRole("textbox")).toHaveValue("");
    expect(note).not.toHaveTextContent("stricter criterion");
    expect(screen.queryByTestId("customize-chip-note")).not.toBeInTheDocument();
  });
});

describe("what the run covers", () => {
  const planSubject = (): RunDialogSubject => ({
    kind: "plan",
    initialTarget: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    useAgentTestingStore.setState({ lastRunTarget: null, pendingRun: null });
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT, OFFLINE_AGENT] });
    mockPromptsGetAll.mockReturnValue({ data: [] });
    mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockRunConfigurations.mockReturnValue({ data: [], isLoading: false });
    mockTestSuitesGetAll.mockReturnValue({
      data: [
        { id: "suite_refunds", name: "Refunds", slug: "refunds" },
        { id: "suite_billing", name: "Billing", slug: "billing" },
      ],
      isLoading: false,
    });
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 2,
      suiteId: "plan_1",
      planName: "2 scenarios prod-agent",
      created: true,
    });
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: ["billing"],
          testSuiteId: "suite_refunds",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
        {
          id: "case_2",
          name: "Late invoice",
          labels: ["invoices"],
          testSuiteId: "suite_billing",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
  });

  afterEach(cleanup);

  /** @scenario "An entry point that fixed the scope says nothing about it" */
  it("says nothing about the scope when the entry point already fixed it", () => {
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    expect(screen.queryByTestId("run-scope")).not.toBeInTheDocument();
    expect(screen.getByTestId("run-dialog")).not.toHaveTextContent("Runs as");
    expect(screen.getByTestId("run-dialog")).not.toHaveTextContent("will run");
  });

  /** @scenario "New run plan opens the same dialog with the scope picker" */
  it("opens the same dialog with the four scopes, on all scenarios", () => {
    renderDialog(planSubject());

    expect(screen.getByTestId("run-dialog")).toBeInTheDocument();
    const scope = screen.getByTestId("run-scope");
    expect(within(scope).getByTestId("run-scope-all")).toBeChecked();
    expect(
      within(scope).getByTestId("run-scope-test_suites"),
    ).not.toBeChecked();
    expect(within(scope).getByTestId("run-scope-labels")).not.toBeChecked();
    expect(within(scope).getByTestId("run-scope-scenarios")).not.toBeChecked();
    expect(scope).toHaveTextContent("2 scenarios will run.");
  });

  /** @scenario "A run can be scoped to chosen test suites" */
  it("counts the scenarios of the test suites that are ticked", async () => {
    const user = userEvent.setup();
    renderDialog(planSubject());

    await user.click(screen.getByTestId("run-scope-test_suites"));
    expect(screen.getByTestId("run-scope")).toHaveTextContent(
      "0 scenarios will run.",
    );

    await user.click(screen.getByTestId("run-scope-test-suite-suite_refunds"));
    expect(screen.getByTestId("run-scope")).toHaveTextContent(
      "1 scenario will run.",
    );
  });

  /** @scenario "A run can be scoped to chosen labels" */
  it("reads every label of the project and counts the ones that are on", async () => {
    const user = userEvent.setup();
    renderDialog(planSubject());

    await user.click(screen.getByTestId("run-scope-labels"));
    const labels = screen.getByTestId("run-scope-labels-list");
    expect(
      within(labels).getByTestId("run-scope-label-billing"),
    ).toBeInTheDocument();
    expect(
      within(labels).getByTestId("run-scope-label-invoices"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("run-scope-label-invoices"));
    expect(screen.getByTestId("run-scope")).toHaveTextContent(
      "1 scenario will run.",
    );
  });

  /** @scenario "A run can hold a hand-picked list of scenarios" */
  /** @scenario "A run plan can select single scenarios grouped by their test suite" */
  it("lists the scenarios under their test suite and runs the ticked ones", async () => {
    const user = userEvent.setup();
    renderDialog(planSubject());
    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));

    await user.click(screen.getByTestId("run-scope-scenarios"));
    const cases = screen.getByTestId("run-scope-cases-list");
    expect(cases).toHaveTextContent("Refunds");
    expect(cases).toHaveTextContent("Billing");

    await user.click(screen.getByTestId("run-scope-case-case_2"));
    expect(screen.getByTestId("run-scope")).toHaveTextContent(
      "1 scenario will run.",
    );

    // One scenario out of each test suite, which is the plan that picker exists for.
    await user.click(screen.getByTestId("run-scope-case-case_1"));
    expect(screen.getByTestId("run-scope")).toHaveTextContent(
      "2 scenarios will run.",
    );

    await user.click(screen.getByTestId("run-dialog-run"));
    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    const sent = mockSuitesRunPlan.mock.calls[0]![0] as {
      config: { scope: { mode: string }; scenarioIds?: string[] };
    };
    expect(sent.config.scope).toEqual({ mode: "scenarios" });
    expect([...(sent.config.scenarioIds ?? [])].sort()).toEqual([
      "case_1",
      "case_2",
    ]);
  });

  /** @scenario "Running a stored run plan again keeps the scope it holds" */
  it("runs a stored plan on the scope it holds, not on its own id", async () => {
    const user = userEvent.setup();
    // The Results tab opens a stored plan as a subject that carries the plan's
    // own rule. Derived from its id instead, the rule would name a test suite that
    // holds nothing and would overwrite the plan's real scope.
    renderDialog({
      kind: "suite",
      suiteId: "plan_nightly",
      name: "Nightly refunds",
      scenarioIds: ["case_1", "case_2"],
      scope: { mode: "scenarios", scenarioIds: ["case_1", "case_2"] },
      initialTarget: { type: "http", id: "agent_1" },
    });

    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    const sent = mockSuitesRunPlan.mock.calls[0]![0] as {
      config: { scope: { mode: string }; scenarioIds?: string[] };
    };
    expect(sent.config.scope).toEqual({ mode: "scenarios" });
    expect([...(sent.config.scenarioIds ?? [])].sort()).toEqual([
      "case_1",
      "case_2",
    ]);
  });

  /** @scenario "A run of one scenario is named after that scenario" */
  it("names a run of one scenario after that scenario, never after a count", async () => {
    const user = userEvent.setup();
    renderDialog(planSubject());
    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));

    await user.click(screen.getByTestId("run-scope-scenarios"));
    await user.click(screen.getByTestId("run-scope-case-case_2"));

    const name = screen.getByTestId("run-dialog-name");
    expect(name).toHaveValue("Late invoice prod-agent");
    // A count names every single-scenario run of that agent the same thing.
    expect(name).not.toHaveValue(expect.stringContaining("1 scenario"));

    // Two of them do read as a count, which says what it means there.
    await user.click(screen.getByTestId("run-scope-case-case_1"));
    expect(name).toHaveValue("2 scenarios prod-agent");
  });

  /** @scenario "The derived name follows the scope while it is being picked" */
  it("names the test suite that was ticked, beside the agent", async () => {
    const user = userEvent.setup();
    renderDialog(planSubject());

    await user.click(screen.getByTestId("run-dialog-agent-agent_1"));
    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "All scenarios prod-agent",
    );

    await user.click(screen.getByTestId("run-scope-test_suites"));
    await user.click(screen.getByTestId("run-scope-test-suite-suite_billing"));

    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Billing prod-agent",
    );
  });
});

describe("the chips that add a run option", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    useAgentTestingStore.setState({ lastRunTarget: null, pendingRun: null });
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT, OFFLINE_AGENT] });
    mockPromptsGetAll.mockReturnValue({ data: [] });
    mockScenariosGetAll.mockReturnValue({
      data: [
        {
          id: "case_1",
          name: "Double charge",
          labels: [],
          testSuiteId: "suite_refunds",
          parameters: null,
          createdAt: new Date("2026-07-06T12:00:00.000Z"),
          lastUpdatedById: null,
          version: 1,
        },
      ],
      isLoading: false,
    });
    mockTestSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockRunConfigurations.mockReturnValue({ data: [], isLoading: false });
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 1,
      suiteId: "plan_1",
      planName: "Refunds prod-agent",
      created: true,
    });
  });

  afterEach(cleanup);

  /** @scenario "The compare chip turns the run into a comparison" */
  it("turns the agent section into rows, sends every row, and puts the first back on removal", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-compare"));

    expect(
      screen.queryByTestId("run-dialog-target-section"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-compare-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-compare-row-1")).toBeInTheDocument();
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      config: {
        targets: [
          { type: "http", referenceId: "agent_1" },
          { type: "http", referenceId: "agent_2" },
        ],
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Remove the comparison" }),
    );
    expect(screen.queryByTestId("run-dialog-compare")).not.toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-agent-agent_1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  /** @scenario "The simulation models chip adds the user simulator and the judge" */
  it("adds the user simulator and the judge", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-models"));

    const models = screen.getByTestId("run-dialog-models");
    expect(models).toHaveTextContent("User simulator");
    expect(models).toHaveTextContent("Judge");
    expect(
      screen.queryByTestId("customize-chip-models"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The repeat chip adds the repeat count" */
  it("adds a repeat count and sends it with the run", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-repeat"));
    const count = screen.getByLabelText("Repeat count");
    await user.clear(count);
    await user.type(count, "3");
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    expect(mockSuitesRunPlan.mock.calls[0]![0]).toMatchObject({
      config: { repeatCount: 3 },
    });
  });
});

describe("the comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasProviders.value = true;
    useAgentTestingStore.setState({ lastRunTarget: null, pendingRun: null });
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT, OFFLINE_AGENT] });
    mockPromptsGetAll.mockReturnValue({ data: [] });
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([{ name: "locale", defaultValue: "en" }]),
    );
    mockTestSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });
    mockRunConfigurations.mockReturnValue({ data: [], isLoading: false });
    mockSuitesRunPlan.mockResolvedValue({
      batchRunId: "batch_new",
      jobCount: 1,
      suiteId: "plan_1",
      planName: "Refunds prod-agent",
      created: true,
    });
  });

  afterEach(cleanup);

  /**
   * Opens the dialog on the first agent with the parameter block open, which
   * prefills the line with the declared "locale=en".
   */
  async function openWithParameters(user: ReturnType<typeof userEvent.setup>) {
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );
    await user.click(screen.getByTestId("customize-chip-params"));
  }

  /** Writes a parameter line onto one row of the comparison. */
  async function writeRowParameters(
    user: ReturnType<typeof userEvent.setup>,
    index: number,
    line: string,
  ) {
    const input = screen.getByTestId(`run-dialog-compare-parameters-${index}`);
    await user.clear(input);
    if (line !== "") await user.type(input, line);
  }

  /** @scenario "Compare agents replaces the agent and the parameter sections" */
  it("replaces the agent and the parameter sections with two coloured rows", async () => {
    const user = userEvent.setup();
    await openWithParameters(user);

    await user.click(screen.getByTestId("customize-chip-compare"));

    expect(
      screen.queryByTestId("run-dialog-target-section"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("run-dialog-parameters"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("customize-chip-params"),
    ).not.toBeInTheDocument();
    const section = screen.getByTestId("run-dialog-compare");
    expect(within(section).getByText("Compare agents")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^run-dialog-compare-row-/)).toHaveLength(2);
    expect(screen.getByTestId("run-dialog-compare-dot-0")).toHaveAttribute(
      "data-color",
      targetColor(0),
    );
    expect(screen.getByTestId("run-dialog-compare-dot-1")).toHaveAttribute(
      "data-color",
      targetColor(1),
    );
  });

  /** @scenario "The first row is the agent that was chosen with its parameter line" */
  /** @scenario "The second row defaults to the next agent with the same parameter line" */
  it("opens on the chosen agent with its line, and the next agent with the same line", async () => {
    const user = userEvent.setup();
    await openWithParameters(user);

    await user.click(screen.getByTestId("customize-chip-compare"));

    expect(screen.getByTestId("run-dialog-compare-agent-0")).toHaveValue(
      "agent_1",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-0")).toHaveValue(
      "locale=en",
    );
    expect(screen.getByTestId("run-dialog-compare-agent-1")).toHaveValue(
      "agent_2",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-1")).toHaveValue(
      "locale=en",
    );
    // The list offers the same agents as the picker, tunnel mark included.
    expect(
      within(screen.getByTestId("run-dialog-compare-agent-1")).getByRole(
        "option",
        { name: "prod-agent · Local tunnel" },
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "The second row defaults to the same agent when there is no other" */
  it("opens the second row on the same agent with the same line when the project has one agent", async () => {
    const user = userEvent.setup();
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT] });
    await openWithParameters(user);

    await user.click(screen.getByTestId("customize-chip-compare"));

    expect(screen.getByTestId("run-dialog-compare-agent-1")).toHaveValue(
      "agent_1",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-1")).toHaveValue(
      "locale=en",
    );
  });

  /** @scenario "A row is added as a copy of the last row, up to four" */
  it("adds a copy of the last row, and stops at four", async () => {
    const user = userEvent.setup();
    await openWithParameters(user);
    await user.click(screen.getByTestId("customize-chip-compare"));
    await writeRowParameters(user, 1, "locale=de");

    await user.click(screen.getByTestId("run-dialog-compare-add"));

    expect(screen.getByTestId("run-dialog-compare-agent-2")).toHaveValue(
      "agent_2",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-2")).toHaveValue(
      "locale=de",
    );

    await user.click(screen.getByTestId("run-dialog-compare-add"));
    expect(screen.getAllByTestId(/^run-dialog-compare-row-/)).toHaveLength(4);
    expect(
      screen.queryByTestId("run-dialog-compare-add"),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The hint under the rows says the same agent twice works" */
  it("reads the hint under the rows", async () => {
    const user = userEvent.setup();
    await openWithParameters(user);

    await user.click(screen.getByTestId("customize-chip-compare"));

    expect(screen.getByTestId("run-dialog-compare-hint")).toHaveTextContent(
      COMPARE_HINT,
    );
  });

  /** @scenario "Removing a row down to one leaves compare mode with that row as the agent" */
  it("leaves compare mode with the remaining row as the agent to be tested", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );
    await user.click(screen.getByTestId("customize-chip-compare"));

    await user.click(screen.getByRole("button", { name: "Remove target 1" }));

    expect(screen.queryByTestId("run-dialog-compare")).not.toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-agent-agent_2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("run-dialog-name")).toHaveValue(
      "Refunds staging-agent",
    );
  });

  /** @scenario "Removing the section puts the first row back" */
  it("puts the first row back as the agent, with its line in the parameter section", async () => {
    const user = userEvent.setup();
    await openWithParameters(user);
    await user.click(screen.getByTestId("customize-chip-compare"));
    await writeRowParameters(user, 0, "locale=de");

    await user.click(
      screen.getByRole("button", { name: "Remove the comparison" }),
    );

    expect(screen.getByTestId("run-dialog-agent-agent_1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("run-dialog-parameter-line")).toHaveValue(
      "locale=de",
    );
  });

  /** @scenario "Removing the section puts the first row back" */
  it("folds the parameter section away when the first row had no line", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );
    await user.click(screen.getByTestId("customize-chip-compare"));

    await user.click(
      screen.getByRole("button", { name: "Remove the comparison" }),
    );

    expect(
      screen.queryByTestId("run-dialog-parameters"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("customize-chip-params")).toBeInTheDocument();
  });

  /** @scenario "Two rows with the same agent and the same parameters are refused" */
  it("refuses two rows of the same agent with the same parameters and holds Run", async () => {
    const user = userEvent.setup();
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT] });
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );
    await user.click(screen.getByTestId("customize-chip-compare"));
    await writeRowParameters(user, 0, "model=gpt-5-mini");
    await writeRowParameters(user, 1, "model=gpt-5-mini");

    expect(screen.getByTestId("run-dialog-compare-error")).toHaveTextContent(
      DUPLICATE_TARGETS_MESSAGE,
    );
    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();

    await writeRowParameters(user, 1, "model=gpt-5");
    expect(
      screen.queryByTestId("run-dialog-compare-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("run-dialog-run")).toBeEnabled();
  });

  /** @scenario "The secret parameters of the scope are one shared block" */
  it("shows one shared secret block under the rows and waits for its value", async () => {
    const user = userEvent.setup();
    mockScenariosGetAll.mockReturnValue(
      casesDeclaring([
        { name: "locale", defaultValue: "en" },
        { name: "api_token", secret: true },
      ]),
    );
    renderDialog(
      suiteSubject({ initialTarget: { type: "http", id: "agent_1" } }),
    );

    await user.click(screen.getByTestId("customize-chip-compare"));

    const secrets = screen.getByTestId("run-dialog-compare-secrets");
    expect(within(secrets).getByText("Secret parameters")).toBeInTheDocument();
    const value = within(secrets).getByTestId(
      "run-dialog-parameter-value-api_token",
    );
    expect(value).toHaveAttribute("type", "password");
    expect(screen.getByTestId("run-dialog-run")).toBeDisabled();

    await user.type(value, "tok_1");
    expect(screen.getByTestId("run-dialog-run")).toBeEnabled();
    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    const input = mockSuitesRunPlan.mock.calls[0]![0];
    // The secret goes with the run alone, shared by every target.
    expect(input.parameters).toEqual({ api_token: "tok_1" });
    expect(input.config.targets[0].runParameters).toBeUndefined();
  });

  /** @scenario "Each target carries its own parameters" */
  it("sends each target with its own parameters and no run-level ones", async () => {
    const user = userEvent.setup();
    mockAgentsGetAll.mockReturnValue({ data: [ONLINE_AGENT] });
    await openWithParameters(user);
    await user.click(screen.getByTestId("customize-chip-compare"));
    await writeRowParameters(user, 0, "locale=en, model=gpt-5");
    await writeRowParameters(user, 1, "locale=en, model=gpt-5-mini");

    await user.click(screen.getByTestId("run-dialog-run"));

    await waitFor(() => expect(mockSuitesRunPlan).toHaveBeenCalled());
    const input = mockSuitesRunPlan.mock.calls[0]![0];
    expect(input.config.targets).toEqual([
      {
        type: "http",
        referenceId: "agent_1",
        runParameters: { locale: "en", model: "gpt-5" },
      },
      {
        type: "http",
        referenceId: "agent_1",
        runParameters: { locale: "en", model: "gpt-5-mini" },
      },
    ]);
    // One layer of parameters: the rows carry them all, the run carries none.
    expect(input.parameters).toBeUndefined();
    // The name reads the value that differs and leaves the shared one out.
    expect(input.name).toBe(
      "Refunds prod-agent · model=gpt-5 vs prod-agent · model=gpt-5-mini",
    );
  });

  /** @scenario "A stored comparison comes back with every target and its parameters" */
  it("restores three rows, each with the parameters of its target", async () => {
    const user = userEvent.setup();
    mockRunConfigurations.mockReturnValue({
      data: [
        configurationEntry({
          planName: "Model bake-off",
          targets: [
            {
              type: "http",
              referenceId: "agent_1",
              runParameters: { model: "gpt-5" },
            },
            {
              type: "http",
              referenceId: "agent_1",
              runParameters: { model: "gpt-5-mini" },
            },
            { type: "http", referenceId: "agent_2" },
          ],
        }),
      ],
      isLoading: false,
    });
    renderDialog(suiteSubject());

    await user.click(screen.getByTestId("run-dialog-name-caret"));
    await user.click(
      within(await screen.findByTestId("run-dialog-name-options")).getAllByRole(
        "button",
      )[0]!,
    );

    expect(screen.getAllByTestId(/^run-dialog-compare-row-/)).toHaveLength(3);
    expect(screen.getByTestId("run-dialog-compare-agent-0")).toHaveValue(
      "agent_1",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-0")).toHaveValue(
      "model=gpt-5",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-1")).toHaveValue(
      "model=gpt-5-mini",
    );
    expect(screen.getByTestId("run-dialog-compare-agent-2")).toHaveValue(
      "agent_2",
    );
    expect(screen.getByTestId("run-dialog-compare-parameters-2")).toHaveValue(
      "",
    );
  });

  /** @scenario "The footer counts the targets" */
  it("reads the scenarios and the targets on Run", async () => {
    const user = userEvent.setup();
    renderDialog(
      suiteSubject({
        initialTarget: { type: "http", id: "agent_1" },
        scenarioIds: ["case_1", "case_2", "case_3"],
      }),
    );
    expect(screen.getByTestId("run-dialog-run")).toHaveTextContent(
      "Run 3 scenarios",
    );

    await user.click(screen.getByTestId("customize-chip-compare"));

    expect(screen.getByTestId("run-dialog-run")).toHaveTextContent(
      "Run 3 scenarios × 2 targets",
    );
  });
});
