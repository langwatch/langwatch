/**
 * @vitest-environment jsdom
 *
 * Integration tests for the if/else properties panel: the Liquid/Code
 * condition modes and the toggle between them. Monaco-based editors are
 * mocked (they don't mount in jsdom); their behavior is browser-verified.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Component } from "../../../types/dsl";

const mockSetNodeParameter = vi.fn();
const mockSetNode = vi.fn();
const mockSetEdges = vi.fn();

vi.mock("../../../hooks/useWorkflowStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../hooks/useWorkflowStore")>();
  return {
    ...actual,
    useWorkflowStore: (selector: (state: unknown) => unknown) =>
      selector({
        setNodeParameter: mockSetNodeParameter,
        setNode: mockSetNode,
        setEdges: mockSetEdges,
        nodes: [],
        edges: [],
        getWorkflow: () => ({ nodes: [], edges: [] }),
      }),
  };
});

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock("~/components/blocks/CodeBlockEditor", () => ({
  CodeBlockEditor: ({ code }: { code: string }) => (
    <div data-testid="code-editor">{code}</div>
  ),
}));

vi.mock("../BasePropertiesPanel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../BasePropertiesPanel")>();
  return {
    ...actual,
    BasePropertiesPanel: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="base-properties-panel">{children}</div>
    ),
  };
});

vi.mock("../../code/LiquidConditionEditor", () => ({
  LiquidConditionEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      data-testid="if-else-condition-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { IfElsePropertiesPanel } from "../IfElsePropertiesPanel";

const createIfElseNode = (
  overrides: Partial<Component> = {},
): Node<Component> => ({
  id: "gate",
  type: "if_else",
  position: { x: 0, y: 0 },
  data: {
    name: "If/Else",
    parameters: [
      { identifier: "condition", type: "str", value: 'context != ""' },
      { identifier: "condition_language", type: "str", value: "liquid" },
    ],
    inputs: [{ identifier: "context", type: "str" }],
    outputs: [
      { identifier: "true", type: "bool" },
      { identifier: "false", type: "bool" },
    ],
    ...overrides,
  },
});

const renderPanel = (node = createIfElseNode()) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <IfElsePropertiesPanel node={node} />
    </ChakraProvider>,
  );

describe("IfElsePropertiesPanel", () => {
  beforeEach(() => {
    mockSetNodeParameter.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the condition language is liquid", () => {
    /** @scenario Editing the condition expression in the properties panel */
    it("renders the condition editor with the current expression", () => {
      renderPanel();

      const input = screen.getByTestId("if-else-condition-input");
      expect(input).toHaveValue('context != ""');

      fireEvent.change(input, { target: { value: "score > 0.5" } });
      expect(mockSetNodeParameter).toHaveBeenCalledWith("gate", {
        identifier: "condition",
        type: "str",
        value: "score > 0.5",
      });
    });

    /** @scenario The condition help links to the Liquid documentation */
    it("links the help text to the liquid operators docs", () => {
      renderPanel();

      const link = screen.getByRole("link", { name: /Liquid condition/ });
      expect(link).toHaveAttribute(
        "href",
        "https://shopify.github.io/liquid/basics/operators/",
      );
    });

    /** @scenario Toggling Code seeds a python template from the inputs */
    it("seeds the python template from the node inputs on first toggle", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole("checkbox"));

      expect(mockSetNodeParameter).toHaveBeenCalledWith("gate", {
        identifier: "condition_language",
        type: "str",
        value: "python",
      });
      const codeCall = mockSetNodeParameter.mock.calls.find(
        (c) => (c[1] as { identifier: string }).identifier === "code",
      );
      expect(codeCall).toBeTruthy();
      const template = (codeCall![1] as { value: string }).value;
      expect(template).toContain("def execute(context: str) -> bool:");
      expect(template).toContain('return context != ""');
    });
  });

  describe("when editing the inputs", () => {
    /** @scenario The if/else inputs use the shared field editor */
    it("renders the inputs with the shared field editor and image support", () => {
      renderPanel();

      expect(screen.getByText("context")).toBeInTheDocument();
      expect(screen.getByTestId("add-variable-button")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Image" })).toBeInTheDocument();
    });
  });

  describe("when the condition language is python", () => {
    const pythonNode = () =>
      createIfElseNode({
        parameters: [
          { identifier: "condition", type: "str", value: 'context != ""' },
          { identifier: "condition_language", type: "str", value: "python" },
          {
            identifier: "code",
            type: "code",
            value: "def execute(context: str) -> bool:\n    return True\n",
          },
        ],
      });

    /** @scenario Code mode renders the python editor instead of the expression input */
    it("renders the code editor with the stored python", () => {
      renderPanel(pythonNode());

      expect(screen.getByTestId("code-editor")).toHaveTextContent(
        "def execute(context: str) -> bool:",
      );
      expect(
        screen.queryByTestId("if-else-condition-input"),
      ).not.toBeInTheDocument();
    });

    /** @scenario Toggling Code off returns to the liquid expression */
    it("switches back to liquid without reseeding the code", async () => {
      const user = userEvent.setup();
      renderPanel(pythonNode());

      await user.click(screen.getByRole("checkbox"));

      expect(mockSetNodeParameter).toHaveBeenCalledWith("gate", {
        identifier: "condition_language",
        type: "str",
        value: "liquid",
      });
      const codeCalls = mockSetNodeParameter.mock.calls.filter(
        (c) => (c[1] as { identifier: string }).identifier === "code",
      );
      expect(codeCalls).toHaveLength(0);
    });
  });
});
