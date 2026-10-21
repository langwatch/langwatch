/**
 * Drawers opened by address carry only the address; each reads what it draws itself.
 * @vitest-environment jsdom
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { generateUniqueIdentifier } from "@langwatch/design-system/variable-mapping";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const drawer = vi.hoisted(() => ({ closeDrawer: vi.fn(), goBack: vi.fn(), canGoBack: false }));
const stack = vi.hoisted(() => ({ entries: [] as { drawer: string }[] }));
const listed = vi.hoisted(() => ({ rows: [] as unknown[] }));
const opener = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
  onInputMappingsChange: undefined as ((...args: unknown[]) => void) | undefined,
}));
const fetched = vi.hoisted(() => ({ agent: undefined as unknown, workflow: undefined as unknown }));
const calls = vi.hoisted(() => ({
  navigate: [] as string[],
  workflowCreated: [] as unknown[],
  agentCreated: [] as unknown[],
  agentUpdated: [] as unknown[],
  listInvalidated: [] as unknown[],
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ ...drawer, openDrawer: vi.fn() }),
  getDrawerStack: () => stack.entries,
  getComplexProps: () => opener.props,
  getFlowCallbacks: () =>
    opener.onInputMappingsChange
      ? { onInputMappingsChange: opener.onInputMappingsChange }
      : undefined,
}));

vi.mock("../../../model/agent-management-host.ts", () => ({
  useAgentManagementHost: () => ({
    project: () => ({ id: "project_1", slug: "acme" }),
    navigate: (to: string) => calls.navigate.push(to),
    failed: vi.fn(),
    succeeded: vi.fn(),
    describeFailure: () => "failed",
    agents: () => ({}),
    openAgentEditor: vi.fn(),
  }),
}));

vi.mock("../../../behavior/agent-api.ts", () => {
  const mutation = (mutateAsync: (input: unknown) => Promise<unknown>) => ({
    useMutation: () => ({ mutateAsync, mutate: vi.fn(), isPending: false, error: null }),
  });
  return {
    agentApi: {
      useUtils: () => ({
        agents: {
          getAll: {
            invalidate: (input: unknown) => {
              calls.listInvalidated.push(input);
              return Promise.resolve();
            },
          },
        },
      }),
      agents: {
        getAll: { useQuery: () => ({ data: listed.rows, isLoading: false }) },
        getById: { useQuery: () => ({ data: fetched.agent, isLoading: false, isError: false }) },
        create: mutation((input) => {
          calls.agentCreated.push(input);
          return Promise.resolve({ id: "agent_new" });
        }),
        update: mutation((input) => {
          calls.agentUpdated.push(input);
          return Promise.resolve({});
        }),
      },
      workflow: {
        getById: {
          useQuery: () => ({ data: fetched.workflow, isLoading: false, isError: false }),
        },
        create: mutation((input) => {
          calls.workflowCreated.push(input);
          return Promise.resolve({ workflow: { id: "workflow_new" } });
        }),
      },
    },
  };
});

vi.mock("../../../model/workflow/templates/blank.template.ts", () => ({
  blankTemplate: { name: "Blank", nodes: [] },
}));

vi.mock("../../../model/workflow/random-workflow-icon.ts", () => ({
  getRandomWorkflowIcon: () => "🧩",
}));

vi.mock("../../elements/workflow/code/workflow-code-editor.tsx", () => ({
  WorkflowCodeEditorModal: () => null,
}));

vi.mock("@langwatch/trace-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SetupWithAgentButton: ({ surface }: { surface: string }) => (
    <button type="button" data-testid="setup-with-agent" data-surface={surface}>
      Setup via Agent
    </button>
  ),
}));

/**
 * Prompt's lent outputs editor, reduced to its contract: typed rows retyped through onChange, and
 * an add that names the row as the real editor does (first free `output`, `output_1`, ...)
 * and gives a JSON schema output its default schema.
 */
vi.mock("@langwatch/prompt-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  OutputsSection: ({
    title,
    outputs,
    onChange,
    availableTypes,
  }: {
    title: string;
    outputs: { identifier: string; type: string; json_schema?: object }[];
    onChange: (outputs: { identifier: string; type: string; json_schema?: object }[]) => void;
    availableTypes: string[];
  }) => (
    <section aria-label={title}>
      <span>{title}</span>
      {outputs.map((output) => (
        <label key={output.identifier}>
          <span data-testid={`output-name-${output.identifier}`}>{output.identifier}</span>
          <select
            aria-label={`Type of ${output.identifier}`}
            value={output.type}
            onChange={(event) =>
              onChange(
                outputs.map((row) =>
                  row.identifier === output.identifier
                    ? {
                        ...row,
                        type: event.target.value,
                        ...(event.target.value === "json_schema"
                          ? { json_schema: { type: "object", properties: {} } }
                          : {}),
                      }
                    : row,
                ),
              )
            }
          >
            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      ))}
      <select
        aria-label="Add output"
        value=""
        onChange={(event) =>
          onChange([
            ...outputs,
            {
              identifier: generateUniqueIdentifier({
                baseName: "output",
                existingIdentifiers: outputs.map((row) => row.identifier),
              }),
              type: event.target.value,
              ...(event.target.value === "json_schema"
                ? { json_schema: { type: "object", properties: { result: { type: "string" } } } }
                : {}),
            },
          ])
        }
      >
        <option value="">Add</option>
        {availableTypes.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </section>
  ),
}));

vi.mock("@langwatch/scenario-client", async (importOriginal) => {
  return {
    ...(await importOriginal<object>()),
    ParameterLineField: () => null,
    scenarioClient: {
      scenarios: {
        testAgentTurn: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
        testHttpAgent: {
          useMutation: () => ({
            mutateAsync: () => Promise.resolve({ success: true }),
            mutate: vi.fn(),
            isPending: false,
            error: null,
          }),
        },
      },
    },
  };
});

vi.mock("@langwatch/design-system/shiki", () => ({
  useShikiAdapter: () => ({
    loadContextSync: () => ({}),
    getHighlighter:
      () =>
      ({ code }: { code: string }) => ({ highlighted: false, code }),
  }),
  codeToHtml: ({ code }: { code: string }) => Promise.resolve(`<pre>${code}</pre>`),
  codeToHtmlDark: ({ code }: { code: string }) => Promise.resolve(`<pre>${code}</pre>`),
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const {
  RoutedAgentListDrawer,
  RoutedAgentCodeEditorDrawer,
  RoutedAgentHttpEditorDrawer,
  RoutedAgentWorkflowEditorDrawer,
  RoutedAgentWorkflowTargetEditorDrawer,
  RoutedConnectFromCodeDrawer,
  RoutedConnectedAgentDrawer,
  RoutedWorkflowSelectorDrawer,
} = await import("../routed-agent-drawers.tsx");

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

afterEach(() => {
  cleanup();
  listed.rows = [];
  fetched.agent = undefined;
  fetched.workflow = undefined;
  opener.props = {};
  opener.onInputMappingsChange = undefined;
  drawer.closeDrawer.mockReset();
  drawer.goBack.mockReset();
  drawer.canGoBack = false;
  stack.entries = [];
  calls.navigate.length = 0;
  calls.workflowCreated.length = 0;
  calls.agentCreated.length = 0;
  calls.agentUpdated.length = 0;
  calls.listInvalidated.length = 0;
});

describe("the connected agent drawer opened by address", () => {
  it("reads the agent its address names and closes itself", async () => {
    listed.rows = [
      {
        id: "agent_1",
        name: "support-agent",
        type: "connected",
        environment: "production",
        hostLabel: null,
        lastSeenAt: null,
        status: "online",
        instances: [],
        owner: null,
        selectable: true,
        notSelectableReason: null,
        parameters: [{ name: "model", type: "string" }],
        config: {},
      },
    ];
    render(<RoutedConnectedAgentDrawer agentId="agent_1" />, { wrapper });

    expect(screen.getByRole("heading", { name: "support-agent" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("connected-agent-parameters")).getByText("model"),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId("connected-agent-close"));
    expect(drawer.closeDrawer).toHaveBeenCalled();
  });
});

describe("the connect-from-code drawer opened by address", () => {
  it("draws its snippets with copy buttons of its own", async () => {
    render(<RoutedConnectFromCodeDrawer />, { wrapper });

    expect(await screen.findAllByRole("button", { name: /copy/i })).not.toHaveLength(0);
    expect(screen.getByTestId("connect-agent-listening")).toBeInTheDocument();
  });
});

describe("the connect-from-code drawer's agent setup", () => {
  /** @scenario "The connect drawer leads with the agent setup" */
  it("offers the agent setup for the connect-agent surface before the snippets", async () => {
    render(<RoutedConnectFromCodeDrawer />, { wrapper });

    const setup = screen.getByTestId("setup-with-agent");
    expect(setup.dataset.surface).toBe("connectedAgents");
    const firstTab = screen.getByRole("tab", { name: "Python" });
    expect(setup.compareDocumentPosition(firstTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the agent editors opened by address", () => {
  /** @scenario "Clicking HTTP Agent in the type selector opens the HTTP editor drawer" */
  it("mounts the HTTP editor with its form", () => {
    render(<RoutedAgentHttpEditorDrawer />, { wrapper });

    expect(screen.getByRole("heading", { name: "New HTTP Agent" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-name-input")).toBeInTheDocument();
  });

  /** @scenario "HTTP agent editor renders Scenario Mappings section" */
  it("draws the Scenario Mappings section with a row per scenario field", () => {
    render(<RoutedAgentHttpEditorDrawer />, { wrapper });

    expect(screen.getByText("Scenario Mappings")).toBeInTheDocument();
    for (const field of ["input", "messages", "threadId", "session"]) {
      expect(screen.getAllByText(field).length).toBeGreaterThan(0);
    }
  });

  /** @scenario "Clicking Code Agent in the type selector opens the code editor drawer" */
  it("mounts the code editor with its form", () => {
    render(<RoutedAgentCodeEditorDrawer />, { wrapper });

    expect(screen.getByRole("heading", { name: "New Code Agent" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("agent-code-preview")).toBeInTheDocument();
  });

  /** @scenario "Saving a new code agent adds it to the project's agents" */
  it("creates a code agent, has the project's agent list read again and closes", async () => {
    render(<RoutedAgentCodeEditorDrawer />, { wrapper });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("agent-name-input"), "Code Processor");
    await user.click(screen.getByTestId("save-agent-button"));

    await vi.waitFor(() => expect(drawer.closeDrawer).toHaveBeenCalled());
    expect(calls.agentCreated).toEqual([
      expect.objectContaining({ type: "code", name: "Code Processor" }),
    ]);
    expect(calls.listInvalidated).toEqual([{ projectId: "project_1" }]);
  });

  /** @scenario "Clicking Workflow Agent in the type selector opens the workflow selector drawer" */
  it("mounts the workflow selector, which creates the workflow, then its agent, then opens it", async () => {
    render(<RoutedWorkflowSelectorDrawer />, { wrapper });
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { name: "Create Workflow Agent" })).toBeInTheDocument();
    await user.type(screen.getByTestId("agent-name-input"), "Support flow");
    await user.click(screen.getByTestId("save-agent-button"));

    await vi.waitFor(() => expect(calls.navigate).toEqual(["/acme/studio/workflow_new"]));
    expect(calls.workflowCreated).toEqual([
      expect.objectContaining({
        projectId: "project_1",
        commitMessage: "Workflow creation for agent",
      }),
    ]);
    expect(calls.agentCreated).toEqual([
      expect.objectContaining({
        type: "workflow",
        workflowId: "workflow_new",
        name: "Support flow",
      }),
    ]);
  });
});

describe("the HTTP editor opened from another drawer", () => {
  /** @scenario "Saving in a sub-flow returns to the drawer that opened it" */
  it("goes back to that drawer once the agent is saved, leaving the stack open", async () => {
    drawer.canGoBack = true;
    render(<RoutedAgentHttpEditorDrawer />, { wrapper });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("agent-name-input"), "Support bot");
    await user.type(screen.getByTestId("url-input"), "https://example.com/chat");
    await user.click(screen.getByTestId("save-agent-button"));

    await vi.waitFor(() => expect(drawer.goBack).toHaveBeenCalled());
    expect(drawer.closeDrawer).not.toHaveBeenCalled();
  });
});

describe("the HTTP editor chosen in the agent type selector", () => {
  /** @scenario "Saving an agent chosen in the type selector closes the drawer" */
  it("closes once the agent is saved rather than reopening the selector", async () => {
    drawer.canGoBack = true;
    stack.entries = [{ drawer: "agentTypeSelector" }, { drawer: "agentHttpEditor" }];
    render(<RoutedAgentHttpEditorDrawer />, { wrapper });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("agent-name-input"), "Support bot");
    await user.type(screen.getByTestId("url-input"), "https://example.com/chat");
    await user.click(screen.getByTestId("save-agent-button"));

    await vi.waitFor(() => expect(drawer.closeDrawer).toHaveBeenCalled());
    expect(drawer.goBack).not.toHaveBeenCalled();
  });
});

const workflowAgent = {
  id: "agent_wf",
  name: "Workflow agent",
  type: "workflow",
  workflowId: "workflow_1",
  config: { name: "Workflow agent", isCustom: true, workflow_id: "workflow_1" },
};

const linkedWorkflow = {
  id: "workflow_1",
  name: "Support triage",
  icon: "🧭",
  updatedAt: "2026-10-01T10:00:00.000Z",
  currentVersion: {
    dsl: {
      spec_version: "1.5",
      name: "Support triage",
      icon: "🧭",
      description: "",
      version: "1.0",
      nodes: [
        {
          id: "entry",
          type: "entry",
          position: { x: 0, y: 0 },
          data: { name: "Entry", outputs: [{ identifier: "question", type: "str" }] },
        },
      ],
      edges: [],
    },
  },
};

const datasetSources = [
  {
    id: "dataset_1",
    name: "Customer questions",
    type: "dataset",
    fields: [{ name: "user_question", type: "str" }],
  },
];

describe("the workflow agent editor opened by address", () => {
  it("reads the agent its address names and draws its form", () => {
    fetched.agent = workflowAgent;
    render(<RoutedAgentWorkflowEditorDrawer agentId="agent_wf" />, { wrapper });

    expect(screen.getByText("Edit Workflow Agent")).toBeTruthy();
    expect(screen.getByTestId("agent-name-input")).toHaveProperty("value", "Workflow agent");
  });
});

/** A code agent as the previous release stored it, every key it wrote. */
const storedCodeAgent = {
  id: "agent_code",
  name: "Triage code",
  type: "code",
  workflowId: null,
  config: {
    name: "Code",
    description: "Python code block",
    parameters: [{ identifier: "code", type: "code", value: "class Code: ..." }],
    inputs: [
      { identifier: "question", type: "str" },
      { identifier: "locale", type: "str" },
    ],
    outputs: [
      { identifier: "answer", type: "str" },
      { identifier: "confidence", type: "float" },
    ],
    scenarioMappings: { question: { type: "source", sourceId: "scenario", path: ["input"] } },
    scenarioOutputField: "answer",
    timeoutMs: 30_000,
  },
};

describe("the code agent editor opened on a stored agent", () => {
  /** @scenario "Edit config shows the stored inputs, outputs and mappings" */
  it("shows the agent's inputs, outputs and scenario mappings", () => {
    fetched.agent = storedCodeAgent;
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    expect(screen.getByRole("heading", { name: "Edit Code Agent" })).toBeInTheDocument();
    // The agent's own Inputs, then the scenario mapping's.
    expect(screen.getAllByText("Inputs")).toHaveLength(2);
    expect(screen.getByText("Outputs")).toBeInTheDocument();
    for (const identifier of ["question", "locale"]) {
      expect(screen.getByTestId(`variable-name-${identifier}`).textContent).toBe(identifier);
    }
    for (const identifier of ["answer", "confidence"]) {
      expect(screen.getByTestId(`output-name-${identifier}`).textContent).toBe(identifier);
    }
    expect(screen.getByText("Scenario Mappings")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
  });

  /** @scenario "Saving an edited agent keeps the keys the editor does not show" */
  it("saves the stored inputs, outputs, mappings and timeout back unchanged", async () => {
    fetched.agent = storedCodeAgent;
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    await userEvent.setup().click(screen.getByRole("button", { name: "Save Changes" }));

    expect(calls.agentUpdated).toEqual([
      expect.objectContaining({
        id: "agent_code",
        name: "Triage code",
        config: expect.objectContaining({
          inputs: storedCodeAgent.config.inputs,
          outputs: storedCodeAgent.config.outputs,
          scenarioMappings: storedCodeAgent.config.scenarioMappings,
          scenarioOutputField: "answer",
          timeoutMs: 30_000,
        }),
      }),
    ]);
  });
});

/** An HTTP agent as the previous release stored it, every key it wrote. */
const storedHttpAgent = {
  id: "agent_http",
  name: "Support endpoint",
  type: "http",
  workflowId: null,
  config: {
    url: "https://agent.test/chat",
    method: "POST",
    bodyTemplate: '{"q": "{{input}}"}',
    outputPath: "$.answer",
    description: "HTTP API endpoint",
    name: "HTTP",
    headers: [{ key: "X-Team", value: "support" }],
    scenarioMappings: { input: { type: "source", sourceId: "scenario", path: ["input"] } },
    timeoutMs: 20_000,
    sessionPath: "$.session",
    devTunnel: { previousUrl: "https://agent.test/chat" },
    inputs: [{ identifier: "question", type: "str" }],
  },
};

describe("the HTTP agent editor opened on a stored agent", () => {
  it("shows the stored endpoint and saves every stored key back", async () => {
    fetched.agent = storedHttpAgent;
    render(<RoutedAgentHttpEditorDrawer agentId="agent_http" />, { wrapper });

    expect(screen.getByTestId("url-input")).toHaveProperty("value", "https://agent.test/chat");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save Changes" }));

    expect(calls.agentUpdated).toEqual([
      expect.objectContaining({
        id: "agent_http",
        config: expect.objectContaining({
          url: "https://agent.test/chat",
          bodyTemplate: '{"q": "{{input}}"}',
          outputPath: "$.answer",
          headers: [{ key: "X-Team", value: "support" }],
          sessionPath: "$.session",
          timeoutMs: 20_000,
          devTunnel: { previousUrl: "https://agent.test/chat" },
          inputs: [{ identifier: "question", type: "str" }],
        }),
      }),
    ]);
  });
});

const workflowWithEnd = {
  ...linkedWorkflow,
  currentVersion: {
    dsl: {
      ...linkedWorkflow.currentVersion.dsl,
      nodes: [
        ...linkedWorkflow.currentVersion.dsl.nodes,
        {
          id: "end",
          type: "end",
          position: { x: 300, y: 0 },
          data: { name: "End", inputs: [{ identifier: "reply", type: "str" }] },
        },
      ],
    },
  },
};

describe("the workflow agent editor opened on a stored agent", () => {
  it("shows the linked workflow and maps scenario data into its inputs and output", () => {
    fetched.agent = {
      ...workflowAgent,
      config: {
        ...workflowAgent.config,
        scenarioMappings: { question: { type: "source", sourceId: "scenario", path: ["input"] } },
        scenarioOutputField: "reply",
      },
    };
    fetched.workflow = workflowWithEnd;
    render(<RoutedAgentWorkflowEditorDrawer agentId="agent_wf" />, { wrapper });

    expect(screen.getByText("Linked Workflow")).toBeInTheDocument();
    expect(screen.getByText("Support triage")).toBeInTheDocument();
    expect(screen.getByText("Scenario Mappings")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
  });
});

describe("the workflow agent target editor opened by address", () => {
  it("opens from the address alone and closes itself", async () => {
    fetched.agent = workflowAgent;
    render(<RoutedAgentWorkflowTargetEditorDrawer agentId="agent_wf" />, { wrapper });

    expect(screen.getByText("Workflow Agent")).toBeTruthy();
    await userEvent.setup().click(screen.getByTestId("close-drawer-button"));
    expect(drawer.closeDrawer).toHaveBeenCalled();
  });

  /** @scenario "Editing the target opens a mapping drawer, not a dead end" */
  it("shows the linked workflow, a new-tab link into Studio and its real inputs with mapping", () => {
    fetched.agent = workflowAgent;
    fetched.workflow = linkedWorkflow;
    opener.props = { availableSources: datasetSources, inputMappings: {} };
    render(<RoutedAgentWorkflowTargetEditorDrawer agentId="agent_wf" />, { wrapper });

    expect(screen.getByText("Support triage")).toBeTruthy();
    const link = screen.getByTestId("open-workflow-link");
    expect(link.getAttribute("href")).toBe("/acme/studio/workflow_1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("Input Variables")).toBeTruthy();
    expect(screen.getByTestId("variable-name-question").textContent).toBe("question");
    expect(screen.getByTestId("mapping-input-question")).toBeTruthy();
  });

  /** @scenario "Mapping a dataset column to a workflow input field" */
  it("saves a dataset column picked for the workflow's input at once, with no save step", async () => {
    const saved: unknown[][] = [];
    fetched.agent = workflowAgent;
    fetched.workflow = linkedWorkflow;
    opener.props = { availableSources: datasetSources, inputMappings: {} };
    opener.onInputMappingsChange = (...args) => saved.push(args);
    render(<RoutedAgentWorkflowTargetEditorDrawer agentId="agent_wf" />, { wrapper });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("mapping-input-question"));
    await user.click(await screen.findByTestId("field-option-user_question"));

    expect(saved).toEqual([
      ["question", { type: "source", sourceId: "dataset_1", path: ["user_question"] }],
    ]);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("says the lookup failed when the agent names no workflow", () => {
    fetched.agent = { ...workflowAgent, workflowId: null, config: { name: "Workflow agent" } };
    render(<RoutedAgentWorkflowTargetEditorDrawer agentId="agent_wf" />, { wrapper });

    expect(screen.getByTestId("workflow-lookup-error")).toBeTruthy();
  });
});

describe("the agent list drawer opened by address", () => {
  /** @scenario "AgentListDrawer opened by address reads the project's agents itself" */
  it("lists the project's agents and hands a pick to its flow callback", async () => {
    listed.rows = [
      {
        id: "agent_1",
        name: "Code Processor",
        type: "code",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const onSelect = vi.fn();
    render(<RoutedAgentListDrawer onSelect={onSelect} />, { wrapper });

    await userEvent.setup().click(screen.getByText("Code Processor"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "agent_1" }));
    expect(drawer.closeDrawer).toHaveBeenCalled();
  });
});

describe("the code agent editor's outputs", () => {
  /** @scenario "Code agent outputs offer the code output types" */
  it("offers the code output types and a JSON schema", () => {
    fetched.agent = storedCodeAgent;
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    const options = within(screen.getByLabelText("Type of answer")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "str",
      "float",
      "bool",
      "json_schema",
      "dict",
      "list",
      "image",
    ]);
  });

  /** @scenario "Adding a JSON schema output to a code agent saves it with its schema" */
  it("saves a new JSON schema output with its schema, and shows it on reopening", async () => {
    fetched.agent = storedCodeAgent;
    const { unmount } = render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Add output"), "json_schema");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    const schema = { type: "object", properties: { result: { type: "string" } } };
    const saved = calls.agentUpdated[0] as { config: typeof storedCodeAgent.config };
    expect(saved.config.outputs).toEqual([
      ...storedCodeAgent.config.outputs,
      { identifier: "output", type: "json_schema", json_schema: schema },
    ]);

    unmount();
    calls.agentUpdated.length = 0;
    fetched.agent = { ...storedCodeAgent, config: saved.config };
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    expect(screen.getByLabelText("Type of output")).toHaveProperty("value", "json_schema");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(calls.agentUpdated).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({ outputs: saved.config.outputs }),
      }),
    ]);
  });

  /** @scenario "Changing a code agent output's type saves the new type" */
  it("saves an output's new type and keeps the output's other keys", async () => {
    fetched.agent = {
      ...storedCodeAgent,
      config: {
        ...storedCodeAgent.config,
        outputs: [
          { identifier: "answer", type: "str" },
          { identifier: "confidence", type: "float", desc: "How sure it is" },
        ],
      },
    };
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Type of confidence"), "dict");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(calls.agentUpdated).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({
          outputs: [
            { identifier: "answer", type: "str" },
            { identifier: "confidence", type: "dict", desc: "How sure it is" },
          ],
        }),
      }),
    ]);
  });

  /** @scenario "A stored JSON schema output keeps its schema through a save" */
  it("offers and saves back a stored JSON schema output with its schema", async () => {
    const schema = {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
    };
    fetched.agent = {
      ...storedCodeAgent,
      config: {
        ...storedCodeAgent.config,
        outputs: [{ identifier: "verdict", type: "json_schema", json_schema: schema }],
        scenarioOutputField: "verdict",
      },
    };
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    const user = userEvent.setup();
    expect(screen.getByLabelText("Type of verdict")).toHaveProperty("value", "json_schema");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(calls.agentUpdated).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({
          outputs: [{ identifier: "verdict", type: "json_schema", json_schema: schema }],
        }),
      }),
    ]);
  });

  it("drops the schema when a JSON schema output is retyped", async () => {
    fetched.agent = {
      ...storedCodeAgent,
      config: {
        ...storedCodeAgent.config,
        outputs: [{ identifier: "verdict", type: "json_schema", json_schema: { type: "object" } }],
        scenarioOutputField: "verdict",
      },
    };
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Type of verdict"), "str");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(calls.agentUpdated).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({ outputs: [{ identifier: "verdict", type: "str" }] }),
      }),
    ]);
  });
});

describe("the code agent editor opened from an evaluation workbench", () => {
  /** @scenario "Mapping a dataset column to a code agent input in the workbench" */
  it("maps its inputs to the workbench's dataset and writes a pick at once", async () => {
    const saved: unknown[][] = [];
    fetched.agent = storedCodeAgent;
    opener.props = { availableSources: datasetSources, inputMappings: {} };
    opener.onInputMappingsChange = (...args) => saved.push(args);
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("mapping-input-question"));
    await user.click(await screen.findByTestId("field-option-user_question"));

    expect(saved).toEqual([
      ["question", { type: "source", sourceId: "dataset_1", path: ["user_question"] }],
    ]);
  });

  it("shows no dataset mapping outside a workbench", () => {
    fetched.agent = storedCodeAgent;
    render(<RoutedAgentCodeEditorDrawer agentId="agent_code" />, { wrapper });

    expect(screen.queryByTestId("mapping-input-question")).toBeNull();
  });
});

describe("the HTTP agent editor opened from an evaluation workbench", () => {
  /** @scenario "HTTP agent editor shows the Variables tab in the workbench" */
  it("shows a Variables tab mapping its variables to the workbench's dataset", async () => {
    const saved: unknown[][] = [];
    fetched.agent = storedHttpAgent;
    opener.props = { availableSources: datasetSources, inputMappings: {} };
    opener.onInputMappingsChange = (...args) => saved.push(args);
    render(<RoutedAgentHttpEditorDrawer agentId="agent_http" />, { wrapper });

    expect(screen.getByText("Input Variables")).toBeInTheDocument();
    expect(screen.getByTestId("at-least-one-mapping-error")).toBeInTheDocument();
    const user = userEvent.setup();
    const variablesTab = screen.getByRole("tabpanel", { name: "Variables" });
    await user.click(within(variablesTab).getByTestId("mapping-input-input"));
    await user.click(await screen.findByTestId("field-option-user_question"));

    expect(saved).toEqual([
      ["input", { type: "source", sourceId: "dataset_1", path: ["user_question"] }],
    ]);
    expect(screen.queryByTestId("at-least-one-mapping-error")).toBeNull();
  });

  it("shows no Variables tab outside a workbench", () => {
    fetched.agent = storedHttpAgent;
    render(<RoutedAgentHttpEditorDrawer agentId="agent_http" />, { wrapper });

    expect(screen.queryByText("Input Variables")).toBeNull();
  });
});
