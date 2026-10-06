/**
 * Drawers opened by address carry only the address; each reads what it draws itself.
 * @vitest-environment jsdom
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const drawer = vi.hoisted(() => ({ closeDrawer: vi.fn(), goBack: vi.fn(), canGoBack: false }));
const stack = vi.hoisted(() => ({ entries: [] as { drawer: string }[] }));
const listed = vi.hoisted(() => ({ rows: [] as unknown[] }));
const fetched = vi.hoisted(() => ({ agent: undefined as unknown, workflow: undefined as unknown }));
const calls = vi.hoisted(() => ({
  navigate: [] as string[],
  workflowCreated: [] as unknown[],
  agentCreated: [] as unknown[],
  listInvalidated: [] as unknown[],
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ ...drawer, openDrawer: vi.fn() }),
  getDrawerStack: () => stack.entries,
}));

vi.mock("../../../model/agent-management-host.ts", () => ({
  useAgentManagementHost: () => ({
    project: () => ({ id: "project_1", slug: "acme" }),
    navigate: (to: string) => calls.navigate.push(to),
    failed: vi.fn(),
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
        testTurn: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
        create: mutation((input) => {
          calls.agentCreated.push(input);
          return Promise.resolve({ id: "agent_new" });
        }),
        update: mutation(() => Promise.resolve({})),
      },
      httpProxy: { execute: mutation(() => Promise.resolve({ success: true })) },
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

vi.mock("../workflow/optimization_studio/properties/modals/emoji-picker-modal.tsx", () => ({
  EmojiPickerModal: () => null,
}));

vi.mock("../workflow/code/render-code.tsx", () => ({
  RenderCode: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

vi.mock("../../elements/workflow/code/workflow-code-editor.tsx", () => ({
  WorkflowCodeEditorModal: () => null,
}));

vi.mock("../../../behavior/lent-setup-with-agent-button.tsx", () => ({
  SetupWithAgentButton: ({ surface }: { surface: string }) => (
    <button type="button" data-testid="setup-with-agent" data-surface={surface}>
      Setup via Agent
    </button>
  ),
}));

vi.mock("../../../behavior/lent-parameter-line-field.tsx", () => ({
  ParameterLineField: () => null,
}));

vi.mock("@langwatch/design-system/shiki", () => ({
  useShikiAdapter: () => ({
    loadContextSync: () => ({}),
    getHighlighter:
      () =>
      ({ code }: { code: string }) => ({ highlighted: false, code }),
  }),
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const {
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
  drawer.closeDrawer.mockReset();
  drawer.goBack.mockReset();
  drawer.canGoBack = false;
  stack.entries = [];
  calls.navigate.length = 0;
  calls.workflowCreated.length = 0;
  calls.agentCreated.length = 0;
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

describe("the workflow agent editor opened by address", () => {
  it("reads the agent its address names and draws its form", () => {
    fetched.agent = workflowAgent;
    render(<RoutedAgentWorkflowEditorDrawer agentId="agent_wf" />, { wrapper });

    expect(screen.getByText("Edit Workflow Agent")).toBeTruthy();
    expect(screen.getByTestId("agent-name-input")).toHaveProperty("value", "Workflow agent");
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

  it("says the lookup failed when the agent names no workflow", () => {
    fetched.agent = { ...workflowAgent, workflowId: null, config: { name: "Workflow agent" } };
    render(<RoutedAgentWorkflowTargetEditorDrawer agentId="agent_wf" />, { wrapper });

    expect(screen.getByTestId("workflow-lookup-error")).toBeTruthy();
  });
});
