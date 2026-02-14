/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import type { Node } from "@xyflow/react";
import type { Component, Signature } from "../../../types/dsl";
import type { LocalPromptConfig } from "~/evaluations-v3/types";

// ---- Mocks ----

const mockSetNode = vi.fn();
const mockUpdateNodeInternals = vi.fn();
const mockSetEdges = vi.fn();
const mockDeselectAllNodes = vi.fn();
const mockNodeDataToLocalPromptConfig = vi.fn();

let capturedProps: Record<string, any> = {};
let mockEdges: any[] = [];

vi.mock("~/components/prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: (props: any) => {
    capturedProps = props;
    return <div data-testid="mock-prompt-editor" />;
  },
}));

vi.mock("../../../hooks/useSmartSetNode", () => ({
  useSmartSetNode: () => mockSetNode,
}));

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => mockUpdateNodeInternals,
}));

vi.mock("../../../hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: any) =>
    selector({
      getWorkflow: () => ({ nodes: [], edges: mockEdges }),
      setEdges: mockSetEdges,
      deselectAllNodes: mockDeselectAllNodes,
    }),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: any) => fn,
}));

vi.mock("~/prompts/utils/llmPromptConfigUtils", () => ({
  nodeDataToLocalPromptConfig: (...args: any[]) =>
    mockNodeDataToLocalPromptConfig(...args),
}));

// ---- Helpers ----

function createSignatureNode(
  overrides: Partial<Signature> = {}
): Node<Component> {
  return {
    id: "llm-1",
    type: "signature",
    position: { x: 0, y: 0 },
    data: {
      name: "Test LLM",
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [{ identifier: "answer", type: "str" }],
      ...overrides,
    },
  };
}

// ---- Import under test (after mocks) ----
const { SignaturePromptEditorBridge } = await import(
  "../SignaturePromptEditorBridge"
);

// ---- Tests ----

describe("SignaturePromptEditorBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProps = {};
    mockEdges = [];
    mockNodeDataToLocalPromptConfig.mockReturnValue(undefined);
  });

  describe("when rendering", () => {
    it("passes headless=true to PromptEditorDrawer", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      expect(capturedProps.headless).toBe(true);
    });

    it("passes node promptId and promptVersionId", () => {
      const node = createSignatureNode({
        promptId: "prompt-123",
        promptVersionId: "version-456",
      });
      render(<SignaturePromptEditorBridge node={node} />);

      expect(capturedProps.promptId).toBe("prompt-123");
      expect(capturedProps.promptVersionId).toBe("version-456");
    });

    it("passes deselectAllNodes as onClose", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      capturedProps.onClose();
      expect(mockDeselectAllNodes).toHaveBeenCalled();
    });
  });

  describe("when initialLocalConfig is computed", () => {
    it("uses localPromptConfig when present on node data", () => {
      const localConfig: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [{ role: "system", content: "You are helpful" }],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };
      const node = createSignatureNode({ localPromptConfig: localConfig });
      render(<SignaturePromptEditorBridge node={node} />);

      expect(capturedProps.initialLocalConfig).toBe(localConfig);
      expect(mockNodeDataToLocalPromptConfig).not.toHaveBeenCalled();
    });

    it("returns undefined when node has promptId", () => {
      const node = createSignatureNode({ promptId: "prompt-123" });
      render(<SignaturePromptEditorBridge node={node} />);

      expect(capturedProps.initialLocalConfig).toBeUndefined();
      expect(mockNodeDataToLocalPromptConfig).not.toHaveBeenCalled();
    });

    it("falls back to nodeDataToLocalPromptConfig when no promptId and no localPromptConfig", () => {
      const fallbackConfig: LocalPromptConfig = {
        llm: { model: "gpt-3.5-turbo" },
        messages: [],
        inputs: [],
        outputs: [],
      };
      mockNodeDataToLocalPromptConfig.mockReturnValue(fallbackConfig);

      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      expect(mockNodeDataToLocalPromptConfig).toHaveBeenCalledWith(node.data);
      expect(capturedProps.initialLocalConfig).toBe(fallbackConfig);
    });
  });

  describe("when handleLocalConfigChange is called", () => {
    it("syncs node inputs from config inputs", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [],
        inputs: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
      };

      capturedProps.onLocalConfigChange(config);

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "llm-1",
        data: expect.objectContaining({
          localPromptConfig: config,
          inputs: [
            { identifier: "input", type: "str" },
            { identifier: "context", type: "str" },
          ],
        }),
      });
    });

    it("syncs node outputs from config outputs", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [
          { identifier: "answer", type: "str" },
          { identifier: "reasoning", type: "str" },
        ],
      };

      capturedProps.onLocalConfigChange(config);

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "llm-1",
        data: expect.objectContaining({
          localPromptConfig: config,
          outputs: [
            { identifier: "answer", type: "str" },
            { identifier: "reasoning", type: "str" },
          ],
        }),
      });
    });

    it("calls updateNodeInternals to refresh edge handles", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };

      capturedProps.onLocalConfigChange(config);

      expect(mockUpdateNodeInternals).toHaveBeenCalledWith("llm-1");
    });

    it("updates edge targetHandles when input identifiers change", () => {
      mockEdges = [
        {
          id: "edge-1",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.question",
          targetHandle: "inputs.question",
        },
      ];

      const node = createSignatureNode({
        inputs: [{ identifier: "question", type: "str" }],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };

      capturedProps.onLocalConfigChange(config);

      expect(mockSetEdges).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "edge-1",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.question",
          targetHandle: "inputs.input",
        }),
      ]);
    });

    it("does not update edges when identifiers stay the same", () => {
      mockEdges = [
        {
          id: "edge-1",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.question",
          targetHandle: "inputs.question",
        },
      ];

      const node = createSignatureNode({
        inputs: [{ identifier: "question", type: "str" }],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [],
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };

      capturedProps.onLocalConfigChange(config);

      expect(mockSetEdges).not.toHaveBeenCalled();
    });

    it("stores localPromptConfig as undefined when config is undefined", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      capturedProps.onLocalConfigChange(undefined);

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "llm-1",
        data: { localPromptConfig: undefined },
      });
    });
  });

  describe("when handleSave is called", () => {
    it("clears localPromptConfig and sets promptId", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      capturedProps.onSave({
        id: "prompt-new",
        name: "My Prompt",
        versionId: "v1",
      });

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "llm-1",
        data: expect.objectContaining({
          promptId: "prompt-new",
          promptVersionId: "v1",
          localPromptConfig: undefined,
          name: "My Prompt",
        }),
      });
    });

    it("syncs inputs and outputs from saved prompt", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      capturedProps.onSave({
        id: "prompt-new",
        name: "My Prompt",
        versionId: "v1",
        inputs: [{ identifier: "query", type: "str" }],
        outputs: [{ identifier: "response", type: "str" }],
      });

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "llm-1",
        data: expect.objectContaining({
          inputs: [{ identifier: "query", type: "str" }],
          outputs: [{ identifier: "response", type: "str" }],
        }),
      });
    });
  });

  describe("when handleVersionChange is called", () => {
    it("updates promptVersionId and syncs IO", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      capturedProps.onVersionChange({
        version: 2,
        versionId: "v2",
        inputs: [{ identifier: "new_input", type: "str" }],
        outputs: [{ identifier: "new_output", type: "str" }],
      });

      expect(mockSetNode).toHaveBeenCalledWith({
        id: "llm-1",
        data: expect.objectContaining({
          promptVersionId: "v2",
          inputs: [{ identifier: "new_input", type: "str" }],
          outputs: [{ identifier: "new_output", type: "str" }],
        }),
      });
      expect(mockUpdateNodeInternals).toHaveBeenCalledWith("llm-1");
    });
  });

  describe("when handleInputMappingsChange is called", () => {
    it("creates edge via applyMappingChangeToEdges", () => {
      const node = createSignatureNode({
        inputs: [{ identifier: "question", type: "str" }],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      const mapping = {
        type: "source" as const,
        sourceId: "entry",
        path: ["question"],
      };
      capturedProps.onInputMappingsChange("question", mapping);

      // applyMappingChangeToEdges transforms the mapping into edges
      // and setEdges is called with the result
      expect(mockSetEdges).toHaveBeenCalled();
      expect(mockUpdateNodeInternals).toHaveBeenCalledWith("llm-1");
    });

    it("removes edge when mapping is undefined", () => {
      mockEdges = [
        {
          id: "edge-1",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.question",
          targetHandle: "inputs.question",
        },
      ];
      const node = createSignatureNode({
        inputs: [{ identifier: "question", type: "str" }],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      capturedProps.onInputMappingsChange("question", undefined);

      expect(mockSetEdges).toHaveBeenCalled();
    });
  });

  describe("when undefined config clears only localPromptConfig", () => {
    it("does not touch inputs or outputs on the node", () => {
      const node = createSignatureNode({
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      capturedProps.onLocalConfigChange(undefined);

      // Only localPromptConfig should be in the data, not inputs/outputs
      expect(mockSetNode).toHaveBeenCalledWith({
        id: "llm-1",
        data: { localPromptConfig: undefined },
      });
      // Verify inputs/outputs are NOT included
      const callData = mockSetNode.mock.calls[0]![0].data;
      expect(callData).not.toHaveProperty("inputs");
      expect(callData).not.toHaveProperty("outputs");
    });
  });

  describe("when full config stores localPromptConfig with inputs/outputs", () => {
    it("includes both localPromptConfig and synced inputs/outputs", () => {
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [{ role: "system", content: "Be helpful" }],
        inputs: [{ identifier: "query", type: "str" }],
        outputs: [{ identifier: "response", type: "str" }],
      };

      capturedProps.onLocalConfigChange(config);

      const callData = mockSetNode.mock.calls[0]![0].data;
      expect(callData.localPromptConfig).toBe(config);
      expect(callData.inputs).toEqual([
        { identifier: "query", type: "str" },
      ]);
      expect(callData.outputs).toEqual([
        { identifier: "response", type: "str" },
      ]);
    });
  });

  describe("when edge handles update for multiple inputs", () => {
    it("updates only matching edges, not unrelated edges", () => {
      mockEdges = [
        {
          id: "edge-q",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.question",
          targetHandle: "inputs.question",
        },
        {
          id: "edge-other",
          source: "entry",
          target: "other-node",
          sourceHandle: "outputs.foo",
          targetHandle: "inputs.bar",
        },
      ];

      const node = createSignatureNode({
        inputs: [{ identifier: "question", type: "str" }],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };

      capturedProps.onLocalConfigChange(config);

      const updatedEdges = mockSetEdges.mock.calls[0]![0];
      expect(updatedEdges).toHaveLength(2);
      // First edge updated
      expect(updatedEdges[0]).toEqual(
        expect.objectContaining({
          id: "edge-q",
          targetHandle: "inputs.input",
        }),
      );
      // Second edge untouched
      expect(updatedEdges[1]).toEqual(
        expect.objectContaining({
          id: "edge-other",
          targetHandle: "inputs.bar",
        }),
      );
    });

    it("handles multiple positional input renames", () => {
      mockEdges = [
        {
          id: "edge-1",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.q",
          targetHandle: "inputs.question",
        },
        {
          id: "edge-2",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.c",
          targetHandle: "inputs.context",
        },
      ];

      const node = createSignatureNode({
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "context", type: "str" },
        ],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      const config: LocalPromptConfig = {
        llm: { model: "gpt-4" },
        messages: [],
        inputs: [
          { identifier: "input", type: "str" },
          { identifier: "background", type: "str" },
        ],
        outputs: [],
      };

      capturedProps.onLocalConfigChange(config);

      const updatedEdges = mockSetEdges.mock.calls[0]![0];
      expect(updatedEdges[0]).toEqual(
        expect.objectContaining({
          id: "edge-1",
          targetHandle: "inputs.input",
        }),
      );
      expect(updatedEdges[1]).toEqual(
        expect.objectContaining({
          id: "edge-2",
          targetHandle: "inputs.background",
        }),
      );
    });
  });

  describe("when availableSources and inputMappings are built from edges", () => {
    it("passes inputMappings derived from edges to PromptEditorDrawer", () => {
      mockEdges = [
        {
          id: "edge-1",
          source: "entry",
          target: "llm-1",
          sourceHandle: "outputs.question",
          targetHandle: "inputs.question",
        },
      ];

      const node = createSignatureNode({
        inputs: [{ identifier: "question", type: "str" }],
      });
      render(<SignaturePromptEditorBridge node={node} />);

      // inputMappings should be built from edges
      expect(capturedProps.inputMappings).toBeDefined();
      expect(capturedProps.inputMappings).toEqual(
        expect.objectContaining({
          question: expect.objectContaining({
            type: "source",
          }),
        }),
      );
    });

    it("passes empty inputMappings when no edges connect to node", () => {
      mockEdges = [];
      const node = createSignatureNode();
      render(<SignaturePromptEditorBridge node={node} />);

      expect(capturedProps.inputMappings).toEqual({});
    });
  });
});
