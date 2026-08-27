/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component, End, Entry } from "@langwatch/workflow-contract";
import {
  CodePropertiesPanel,
  EndPropertiesPanel,
  EntryPointPropertiesPanel,
  IfElsePropertiesPanel,
  PromptingTechniquePropertiesPanel,
  RetrievePropertiesPanel,
  type WorkflowBasePropertiesPanelProps,
  type WorkflowCodeEditorProps,
  type WorkflowOutputsProps,
  type WorkflowVariablesProps,
} from "../src/index";
import { _useWorkflowStore } from "../src/hooks/use-workflow-store";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  useUpdateNodeInternals: () => vi.fn(),
}));

const base = ({ children }: WorkflowBasePropertiesPanelProps) => <div>{children}</div>;
const variables = ({ variables, title, onChange }: WorkflowVariablesProps) => (
  <div>
    <span>{title}</span>
    {variables.map((variable) => (
      <span key={variable.identifier}>{variable.identifier}</span>
    ))}
    <button onClick={() => onChange([...variables, { identifier: "new_input", type: "str" }])}>
      add-variable
    </button>
  </div>
);
const outputs = ({ title }: WorkflowOutputsProps) => <span>{title}</span>;
const codeEditor = ({ code, onChange }: WorkflowCodeEditorProps) => (
  <textarea
    data-testid="code-editor"
    value={code}
    onChange={(event) => onChange(event.target.value)}
  />
);
const propertySectionTitle = ({ children }: { children: React.ReactNode }) => (
  <span>{children}</span>
);

const common = {
  renderBase: base,
  renderVariables: variables,
  renderOutputs: outputs,
  renderCodeEditor: codeEditor,
};

const renderPanel = (children: React.ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{children}</ChakraProvider>);

describe("Workflow property panels", () => {
  beforeEach(() => {
    _useWorkflowStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("normalizes evaluator end results to the fixed vocabulary", () => {
    const node: Node<End> = {
      id: "end",
      type: "end",
      position: { x: 0, y: 0 },
      data: {
        name: "End",
        behave_as: "evaluator",
        inputs: [{ identifier: "old", type: "str" }],
      } as End,
    };
    _useWorkflowStore.setState({ nodes: [node] });
    renderPanel(<EndPropertiesPanel {...common} node={node} />);
    expect(_useWorkflowStore.getState().nodes[0]?.data.inputs).toHaveLength(4);
  });

  it("edits code through the workflow store", () => {
    const node: Node<Component> = {
      id: "code",
      type: "code",
      position: { x: 0, y: 0 },
      data: {
        name: "Code",
        parameters: [{ identifier: "code", type: "code", value: "old" }],
      },
    };
    const setNodeParameter = vi.fn();
    _useWorkflowStore.setState({ nodes: [node], setNodeParameter });
    renderPanel(<CodePropertiesPanel {...common} node={node} />);
    fireEvent.change(screen.getByTestId("code-editor"), { target: { value: "new" } });
    expect(setNodeParameter).toHaveBeenCalledWith("code", {
      identifier: "code",
      type: "code",
      value: "new",
    });
  });

  it("shows entry dataset controls and links to the end node", () => {
    const node: Node<Entry> = {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      data: { name: "Entry", outputs: [{ identifier: "input", type: "str" }] } as Entry,
    };
    _useWorkflowStore.setState({
      nodes: [node, { id: "end", type: "end" } as Node<Component>],
    });
    const DatasetModal = ({ open }: { open: boolean }) =>
      open ? <div data-testid="dataset-modal" /> : null;
    renderPanel(
      <EntryPointPropertiesPanel
        {...common}
        node={node}
        datasetTotal={undefined}
        renderDatasetModal={DatasetModal}
        renderPropertySectionTitle={propertySectionTitle}
      />,
    );
    expect(screen.getByTestId("attach-dataset-button")).toBeTruthy();
    expect(screen.getByTestId("go-to-end-node")).toBeTruthy();
  });

  it("renders condition mode and structural panels through named ports", () => {
    const node: Node<Component> = {
      id: "gate",
      type: "if_else",
      position: { x: 0, y: 0 },
      data: {
        name: "Gate",
        parameters: [{ identifier: "condition", type: "str", value: "true" }],
      },
    };
    renderPanel(
      <IfElsePropertiesPanel
        {...common}
        node={node}
        renderPropertySectionTitle={propertySectionTitle}
        renderLiquidConditionEditor={({ value }) => <span>{value}</span>}
      />,
    );
    expect(screen.getByText("true")).toBeTruthy();
    renderPanel(
      <PromptingTechniquePropertiesPanel
        node={{ ...node, type: "prompting_technique" }}
        renderBase={base}
      />,
    );
    renderPanel(
      <RetrievePropertiesPanel node={{ ...node, type: "retriever" }} renderBase={base} />,
    );
  });
});
