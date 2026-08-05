/**
 * @vitest-environment jsdom
 *
 * Integration tests for the agent node's three-way sync: the drawer
 * editor, the workflow DSL node (what executes), and the agent library
 * record. Pins the customer-reported regressions: Save visually
 * reverting the code, the starter template overwriting loaded code,
 * and saves never reaching the node's executed parameters.
 *
 * UX contract: specs/workflows/agent-node-sync.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockAgentQuery, mockMutate, mockSetData, mockSetNode, footerHolder } =
  vi.hoisted(() => ({
    mockAgentQuery: {
      current: { data: undefined as unknown, isLoading: false },
    },
    mockMutate: vi.fn(),
    mockSetData: vi.fn(),
    mockSetNode: vi.fn(),
    footerHolder: { content: null as ReactNode },
  }));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
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

vi.mock("../../../hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      setNode: mockSetNode,
      setEdges: vi.fn(),
      deselectAllNodes: vi.fn(),
      getWorkflow: () => ({ nodes: [], edges: [] }),
    }),
}));

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock("~/components/blocks/CodeBlockEditor", () => ({
  CodeBlockEditor: ({
    code,
    onChange,
  }: {
    code: string;
    onChange: (code: string) => void;
  }) => (
    <textarea
      data-testid="code-textarea"
      value={code}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("../../code/CodeEditorModal", () => ({
  CodeEditorModal: () => null,
}));

vi.mock("~/components/agents/http", () => ({
  HttpConfigEditor: () => null,
  useHttpTest: () => ({ handleTest: vi.fn() }),
}));

vi.mock("~/components/variables", () => ({
  VariablesSection: () => null,
}));

vi.mock("~/components/outputs/OutputsSection", () => ({
  CODE_OUTPUT_TYPES: ["str"],
  OutputsSection: () => null,
}));

vi.mock("../BasePropertiesPanel", () => ({
  BasePropertiesPanel: ({ children }: { children: ReactNode }) => (
    <div data-testid="base-properties-panel">{children}</div>
  ),
}));

vi.mock("../../drawers/useInsideDrawer", () => ({
  useRegisterDrawerFooter: (content: ReactNode) => {
    footerHolder.content = content;
  },
}));

const { AgentPropertiesPanel } = await import("../AgentPropertiesPanel");

import type { AgentComponent } from "../../../types/dsl";

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
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <AgentPropertiesPanel node={node} />
    </ChakraProvider>,
  );
  const rerenderPanel = (nextNode: Node<AgentComponent>) =>
    utils.rerender(
      <ChakraProvider value={defaultSystem}>
        <AgentPropertiesPanel node={nextNode} />
      </ChakraProvider>,
    );
  return { ...utils, rerenderPanel };
}

/** Apply setNode patches the way the store merges them (shallow data merge). */
function nodeWithLastPatch(node: Node<AgentComponent>): Node<AgentComponent> {
  const patches = mockSetNode.mock.calls
    .map(([patch]) => patch as { id: string; data?: Partial<AgentComponent> })
    .filter((patch) => patch.id === node.id);
  const data = patches.reduce(
    (acc, patch) => ({ ...acc, ...(patch.data ?? {}) }),
    node.data,
  );
  return { ...node, data };
}

function renderFooter() {
  return render(
    <ChakraProvider value={defaultSystem}>
      {footerHolder.content}
    </ChakraProvider>,
  );
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
        config: { parameters: Array<{ identifier: string; value: unknown }> };
      };
      expect(
        mutateInput.config.parameters.find((p) => p.identifier === "code")
          ?.value,
      ).toBe("print('v2 edited')");

      // The node snapshot got the edited code and the draft cleared.
      const setNodePatch = mockSetNode.mock.calls.at(-1)![0] as {
        data: AgentComponent;
      };
      expect(
        setNodePatch.data.parameters?.find((p) => p.identifier === "code")
          ?.value,
      ).toBe("print('v2 edited')");
      expect(setNodePatch.data.localConfig).toBeUndefined();

      // The query cache baseline matches the save, no refetch needed.
      expect(mockSetData).toHaveBeenCalledTimes(1);

      // After the store applies the patch, the editor still shows the
      // edited code: nothing reverts.
      rerenderPanel(nodeWithLastPatch(node));
      expect(screen.getByTestId("code-textarea")).toHaveValue(
        "print('v2 edited')",
      );
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
        config: { inputs: Array<{ identifier: string }> };
      };
      expect(mutateInput.config.inputs.map((i) => i.identifier)).toEqual([
        "input",
        "context",
      ]);
    });
  });

  describe("when the agent record is still loading", () => {
    /** @scenario The drawer never shows the starter template for a saved agent */
    it("shows the node's snapshot code, not the starter template", () => {
      mockAgentQuery.current = { data: undefined, isLoading: true };
      renderPanel(agentNode("print('from the dsl snapshot')"));

      expect(screen.getByTestId("code-textarea")).toHaveValue(
        "print('from the dsl snapshot')",
      );
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

      expect(screen.getByTestId("code-textarea")).toHaveValue(
        "print('my draft')",
      );
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

      expect(screen.getByTestId("code-textarea")).toHaveValue(
        "print('v2 from elsewhere')",
      );
      const setNodePatch = mockSetNode.mock.calls.at(-1)![0] as {
        data: AgentComponent;
      };
      expect(
        setNodePatch.data.parameters?.find((p) => p.identifier === "code")
          ?.value,
      ).toBe("print('v2 from elsewhere')");
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

      expect(screen.getByTestId("code-textarea")).toHaveValue(
        "print('my draft')",
      );
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
      expect(
        setNodePatch.data.parameters?.find((p) => p.identifier === "code")
          ?.value,
      ).toBe("print('saved')");
    });
  });
});
