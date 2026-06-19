/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/router
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: vi.fn(),
  }),
}));

// Mock auth-client
vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "test-user" } },
    status: "authenticated",
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

// Mock zustand store
const mockSetNode = vi.fn();
const mockSetNodeParameter = vi.fn();

vi.mock("../../../hooks/useWorkflowStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../hooks/useWorkflowStore")>();
  return {
    ...actual,
    useWorkflowStore: (selector: (state: unknown) => unknown) =>
      selector({
        setNode: mockSetNode,
        setNodeParameter: mockSetNodeParameter,
        nodes: [],
        edges: [],
        getWorkflow: () => ({ nodes: [], edges: [] }),
      }),
  };
});

// Mock ReactFlow hooks
vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

// Mock CodeBlockEditor - we don't need to test Monaco editor
vi.mock("~/components/blocks/CodeBlockEditor", () => ({
  CodeBlockEditor: ({
    code,
    onChange,
  }: {
    code: string;
    onChange: (code: string) => void;
  }) => (
    <div data-testid="code-editor">
      <textarea
        data-testid="code-textarea"
        value={code}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  ),
}));

// Mock components with complex transitive dependencies
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
}));

// Mock BasePropertiesPanel to avoid complex dependencies
vi.mock("../BasePropertiesPanel", () => ({
  BasePropertiesPanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="base-properties-panel">{children}</div>
  ),
}));

import type { Component, Field } from "../../../types/dsl";
import { CodePropertiesPanel } from "../CodePropertiesPanel";

const createMockNode = (
  overrides: Partial<Component> = {},
): Node<Component> => ({
  id: "node-1",
  type: "code",
  position: { x: 0, y: 0 },
  data: {
    name: "Test Code Node",
    cls: "Code",
    parameters: [
      {
        identifier: "code",
        type: "code" as const,
        value: "def main(input):\n  return input",
      },
    ],
    inputs: [{ identifier: "input", type: "str" as const }],
    outputs: [{ identifier: "output", type: "str" as const }],
    ...overrides,
  },
});

const renderComponent = (node: Node<Component> = createMockNode()) => {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CodePropertiesPanel node={node} />
    </ChakraProvider>,
  );
};

describe("CodePropertiesPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("code editor", () => {
    it("renders code editor with current code", () => {
      const node = createMockNode({
        parameters: [
          { identifier: "code", type: "code", value: "print('hello')" },
        ],
      });
      renderComponent(node);

      const textarea = screen.getByTestId("code-textarea");
      expect(textarea).toHaveValue("print('hello')");
    });

    it("renders empty code editor when no code parameter", () => {
      const node = createMockNode({ parameters: [] });
      renderComponent(node);

      const textarea = screen.getByTestId("code-textarea");
      expect(textarea).toHaveValue("");
    });
  });

  describe("inputs section", () => {
    it("renders Inputs title", () => {
      renderComponent();
      expect(screen.getByText("Inputs")).toBeInTheDocument();
    });

    it("displays input variables", () => {
      const node = createMockNode({
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "context", type: "str" },
        ],
      });
      renderComponent(node);

      expect(screen.getByText("question")).toBeInTheDocument();
      expect(screen.getByText("context")).toBeInTheDocument();
    });

    it("shows empty message when no inputs", () => {
      const node = createMockNode({ inputs: [] });
      renderComponent(node);

      expect(screen.getByText("No variables defined")).toBeInTheDocument();
    });
  });

  describe("outputs section", () => {
    it("renders Outputs title", () => {
      renderComponent();
      expect(screen.getByText("Outputs")).toBeInTheDocument();
    });

    it("displays output variables", () => {
      const node = createMockNode({
        outputs: [
          { identifier: "result", type: "str" },
          { identifier: "score", type: "float" },
        ],
      });
      renderComponent(node);

      expect(screen.getByText("result")).toBeInTheDocument();
      expect(screen.getByText("score")).toBeInTheDocument();
    });

    it("shows empty message when no outputs", () => {
      const node = createMockNode({ outputs: [] });
      renderComponent(node);

      expect(screen.getByText("No outputs defined")).toBeInTheDocument();
    });

    it("uses CODE_OUTPUT_TYPES for output type options", async () => {
      const user = userEvent.setup();
      const node = createMockNode({
        outputs: [{ identifier: "output", type: "dict" }],
      });
      renderComponent(node);

      // The dict output (a code-only type) renders in the section
      expect(screen.getByText("output")).toBeInTheDocument();

      // Opening the type selector offers the code types, not json_schema
      await user.click(screen.getByTestId("output-type-select-output"));
      expect(screen.getByTestId("field-type-option-dict")).toBeInTheDocument();
      expect(screen.getByTestId("field-type-option-list")).toBeInTheDocument();
      expect(screen.getByTestId("field-type-option-image")).toBeInTheDocument();
      expect(
        screen.queryByTestId("field-type-option-json_schema"),
      ).not.toBeInTheDocument();
    });
  });

  describe("multiple inputs and outputs", () => {
    it("displays all inputs and outputs together", () => {
      const node = createMockNode({
        inputs: [
          { identifier: "input1", type: "str" },
          { identifier: "input2", type: "float" },
        ],
        outputs: [
          { identifier: "output1", type: "str" },
          { identifier: "output2", type: "list" },
        ],
      });
      renderComponent(node);

      // Inputs
      expect(screen.getByText("input1")).toBeInTheDocument();
      expect(screen.getByText("input2")).toBeInTheDocument();

      // Outputs
      expect(screen.getByText("output1")).toBeInTheDocument();
      expect(screen.getByText("output2")).toBeInTheDocument();
    });
  });
});
