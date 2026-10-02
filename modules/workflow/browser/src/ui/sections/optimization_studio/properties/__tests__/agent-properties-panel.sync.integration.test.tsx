/**
 * @vitest-environment jsdom
 * The agent node's three-way sync (drawer editor, DSL node, library record).
 * Pins regressions: Save reverting code, template overwriting code, lost params.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockAgentQuery, mockMutate, mockSetData, mockSetNode, footerHolder } = vi.hoisted(() => ({
  mockAgentQuery: {
    current: { data: undefined as unknown, isLoading: false },
  },
  mockMutate: vi.fn(),
  mockSetData: vi.fn(),
  mockSetNode: vi.fn(),
  footerHolder: { content: null as ReactNode },
}));

vi.mock("../../../../../behavior/studio-host/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
  }),
}));

vi.mock("../../../../../behavior/workflow-api.ts", () => ({
  workflowApi: {
    useUtils: () => ({
      agents: { getById: { setData: mockSetData } },
    }),
    agents: {
      getById: {
        useQuery: () => ({
          data: mockAgentQuery.current.data,
          isLoading: mockAgentQuery.current.isLoading,
        }),
      },
      update: {
        useMutation: () => ({
          mutate: mockMutate,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("../../../../../behavior/use-workflow-store.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      setNode: mockSetNode,
      setEdges: vi.fn(),
      deselectAllNodes: vi.fn(),
      getWorkflow: () => ({ nodes: [], edges: [] }),
    }),
}));
vi.mock("../../../../elements/studio-drawer-footer.tsx", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRegisterDrawerFooter: (content: ReactNode) => {
    footerHolder.content = content;
  },
}));

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock("../../../blocks/code-block-editor.tsx", () => ({
  CodeBlockEditor: ({ code, onChange }: { code: string; onChange: (code: string) => void }) => (
    <textarea data-testid="code-textarea" value={code} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock("../../code/workflow-code-editor.transport.tsx", () => ({
  CodeEditorModal: () => null,
}));

vi.mock("../../../../../behavior/agents/http/index.ts", () => ({
  useHttpTest: () => ({ handleTest: vi.fn() }),
}));

vi.mock("../../../../../behavior/lent-agent.tsx", () => ({
  HttpConfigEditor: () => null,
}));

vi.mock("../../../prompt/variables/variables-section.tsx", () => ({
  VariablesSection: () => null,
}));

vi.mock("../../../../../behavior/lent-prompt.tsx", () => ({
  OutputsSection: () => null,
}));

vi.mock("../base-properties-panel.tsx", () => ({
  BasePropertiesPanel: ({ children }: { children: ReactNode }) => (
    <div data-testid="base-properties-panel">{children}</div>
  ),
}));

const { AgentPropertiesPanel } = await import("../agent-properties-panel.tsx");

import type { AgentComponent } from "@langwatch/workflow-contract";

const agentRecord = (code: string, name = "custom code agent") => ({
  id: "agent-1",
  name,
  type: "code" as const,
  config: {
    name: "Code",
    description: "Python code block",
    parameters: [{ identifier: "code", type: "code", value: code }],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
});

const agentNode = (
  code: string,
  overrides: Partial<AgentComponent> = {},
): Node<AgentComponent> => ({
  id: "node-1",
  type: "agent",
  position: { x: 0, y: 0 },
  data: {
    name: "custom code agent",
    agent: "agents/agent-1",
    agentType: "code",
    parameters: [
      { identifier: "agent_type", type: "str", value: "code" },
      { identifier: "code", type: "code", value: code },
    ],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    ...overrides,
  },
});

function renderPanel(node: Node<AgentComponent>) {
  const utils = renderWithDesignSystem(<AgentPropertiesPanel node={node} />);
  const rerenderPanel = (nextNode: Node<AgentComponent>) =>
    utils.rerender(<AgentPropertiesPanel node={nextNode} />);
  return { ...utils, rerenderPanel };
}

/** Apply setNode patches the way the store merges them (shallow data merge). */
function nodeWithLastPatch(node: Node<AgentComponent>): Node<AgentComponent> {
  const patches = mockSetNode.mock.calls
    .map(([patch]) => patch as { id: string; data?: Partial<AgentComponent> })
    .filter((patch) => patch.id === node.id);
  const data = patches.reduce((acc, patch) => ({ ...acc, ...patch.data }), node.data);
  return { ...node, data };
}

function renderFooter() {
  return renderWithDesignSystem(footerHolder.content);
}

describe("given a code agent node in a workflow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    footerHolder.content = null;
  });

  describe("when the code is edited and saved", () => {
    /** @scenario Saving keeps the edited code on screen */
    /** @scenario Saving updates what the workflow executes */
    it("keeps the edited code on screen and writes it through to the node and cache", () => {
      mockAgentQuery.current = {
        data: agentRecord("print('v1')"),
        isLoading: false,
      };
      mockMutate.mockImplementation((_input, opts) => opts?.onSuccess?.());
      const node = agentNode("print('v1')");
      const { rerenderPanel } = renderPanel(node);

      fireEvent.change(screen.getByTestId("code-textarea"), {
        target: { value: "print('v2 edited')" },
      });

      const footer = renderFooter();
      fireEvent.click(footer.getByTestId("agent-save-button"));

      // The mutation got the edited code.
      const mutateInput = mockMutate.mock.calls.at(-1)![0] as {
        config: { parameters: { identifier: string; value: unknown }[] };
      };
      expect(mutateInput.config.parameters.find((p) => p.identifier === "code")?.value).toBe(
        "print('v2 edited')",
      );

      // The node snapshot got the edited code and the draft cleared.
      const setNodePatch = mockSetNode.mock.calls.at(-1)![0] as {
        data: AgentComponent;
      };
      expect(setNodePatch.data.parameters?.find((p) => p.identifier === "code")?.value).toBe(
        "print('v2 edited')",
      );
      expect(setNodePatch.data.localConfig).toBeUndefined();

      // The query cache baseline matches the save, no refetch needed.
      expect(mockSetData).toHaveBeenCalledTimes(1);

      // After the store applies the patch, the editor still shows the
      // edited code: nothing reverts.
      rerenderPanel(nodeWithLastPatch(node));
      expect(screen.getByTestId("code-textarea")).toHaveValue("print('v2 edited')");
    });

    /** @scenario Saving syncs the node's inputs and outputs into the agent record */
    it("saves the node's inputs and outputs into the agent record", () => {
      mockAgentQuery.current = {
        data: agentRecord("print('v1')"),
        isLoading: false,
      };
      const node = agentNode("print('v1')", {
        inputs: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
      });
      renderPanel(node);

      const footer = renderFooter();
      fireEvent.click(footer.getByTestId("agent-save-button"));

      const mutateInput = mockMutate.mock.calls.at(-1)![0] as {
        config: { inputs: { identifier: string }[] };
      };
      expect(mutateInput.config.inputs.map((i) => i.identifier)).toEqual(["input", "context"]);
    });
  });

  describe("when the agent record is still loading", () => {
    /** @scenario The drawer never shows the starter template for a saved agent */
    it("shows the node's snapshot code, not the starter template", () => {
      mockAgentQuery.current = { data: undefined, isLoading: true };
      renderPanel(agentNode("print('from the dsl snapshot')"));

      expect(screen.getByTestId("code-textarea")).toHaveValue("print('from the dsl snapshot')");
      expect(screen.queryByText(/Your code goes here/)).not.toBeInTheDocument();
    });
  });

  describe("when there are unsaved edits from a previous session", () => {
    /** @scenario Unsaved edits survive closing and reopening the drawer */
    it("shows the draft and offers Discard", () => {
      mockAgentQuery.current = {
        data: agentRecord("print('saved')"),
        isLoading: false,
      };
      renderPanel(
        agentNode("print('saved')", {
          localConfig: { settings: { code: "print('my draft')" } },
        }),
      );

      expect(screen.getByTestId("code-textarea")).toHaveValue("print('my draft')");
      const footer = renderFooter();
      expect(footer.getByTestId("agent-discard-button")).toBeInTheDocument();
    });
  });

  describe("when the library record changed elsewhere", () => {
    /** @scenario A library change flows into the node when there are no local edits */
    it("applies the newer record to the editor and the node", () => {
      const node = agentNode("print('v1')");
      mockAgentQuery.current = {
        data: agentRecord("print('v1')"),
        isLoading: false,
      };
      const { rerenderPanel } = renderPanel(node);
      expect(mockSetNode).not.toHaveBeenCalled();

      mockAgentQuery.current = {
        data: agentRecord("print('v2 from elsewhere')"),
        isLoading: false,
      };
      rerenderPanel(node);

      expect(screen.getByTestId("code-textarea")).toHaveValue("print('v2 from elsewhere')");
      const setNodePatch = mockSetNode.mock.calls.at(-1)![0] as {
        data: AgentComponent;
      };
      expect(setNodePatch.data.parameters?.find((p) => p.identifier === "code")?.value).toBe(
        "print('v2 from elsewhere')",
      );
    });

    /** @scenario Local edits win over a library refresh until saved or discarded */
    it("keeps the local draft over the refreshed record", () => {
      const node = agentNode("print('v1')", {
        localConfig: { settings: { code: "print('my draft')" } },
      });
      mockAgentQuery.current = {
        data: agentRecord("print('v1')"),
        isLoading: false,
      };
      const { rerenderPanel } = renderPanel(node);

      mockAgentQuery.current = {
        data: agentRecord("print('v2 from elsewhere')"),
        isLoading: false,
      };
      rerenderPanel(node);

      expect(screen.getByTestId("code-textarea")).toHaveValue("print('my draft')");
      expect(mockSetNode).not.toHaveBeenCalled();
    });
  });

  describe("when Discard is clicked on a draft", () => {
    /** @scenario Discard returns to the saved agent definition */
    it("returns the editor to the record and clears the draft from the node", () => {
      mockAgentQuery.current = {
        data: agentRecord("print('saved')"),
        isLoading: false,
      };
      renderPanel(
        agentNode("print('saved')", {
          localConfig: { settings: { code: "print('my draft')" } },
        }),
      );

      const footer = renderFooter();
      fireEvent.click(footer.getByTestId("agent-discard-button"));

      expect(screen.getByTestId("code-textarea")).toHaveValue("print('saved')");
      const setNodePatch = mockSetNode.mock.calls.at(-1)![0] as {
        data: AgentComponent;
      };
      expect(setNodePatch.data.localConfig).toBeUndefined();
      expect(setNodePatch.data.parameters?.find((p) => p.identifier === "code")?.value).toBe(
        "print('saved')",
      );
    });
  });

  describe("when a saved HTTP agent's node carries credential values in its snapshot and draft", () => {
    const CREDENTIAL_VALUE = "value-that-must-not-travel";

    /** @scenario Saving a Studio node never sends credential values */
    it("sends and persists none of them", () => {
      mockAgentQuery.current = {
        data: {
          id: "agent-1",
          name: "http agent",
          type: "http" as const,
          config: {
            name: "HTTP",
            url: "https://example.test/run",
            method: "POST",
            outputPath: "",
            bodyTemplate: "{}",
            headers: [{ key: "X-Tenant", value: "" }],
            auth: { type: "bearer", token: "" },
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
        isLoading: false,
      };
      mockMutate.mockImplementation((_input, opts) => opts?.onSuccess?.());
      renderPanel(
        agentNode("", {
          agentType: "http",
          parameters: [
            { identifier: "agent_type", type: "str", value: "http" },
            { identifier: "url", type: "str", value: "https://example.test/run" },
            { identifier: "auth_type", type: "str", value: "bearer" },
            { identifier: "auth_token", type: "str", value: CREDENTIAL_VALUE },
            { identifier: "headers", type: "dict", value: { "X-Tenant": CREDENTIAL_VALUE } },
          ],
          localConfig: {
            settings: {
              url: "https://example.test/edited",
              headers: [{ key: "X-Tenant", value: CREDENTIAL_VALUE }],
              auth: { type: "bearer", token: CREDENTIAL_VALUE },
            },
          },
        }),
      );

      fireEvent.click(renderFooter().getByTestId("agent-save-button"));

      expect(mockMutate).toHaveBeenCalled();
      expect(JSON.stringify(mockMutate.mock.calls.at(-1)![0])).not.toContain(CREDENTIAL_VALUE);
      expect(JSON.stringify(mockSetNode.mock.calls)).not.toContain(CREDENTIAL_VALUE);
    });
  });
});
