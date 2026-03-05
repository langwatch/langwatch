/**
 * @vitest-environment jsdom
 *
 * Unit tests for useEvaluatorPickerFlow hook.
 * Tests the evaluator picker flow triggered after drag-dropping an Evaluator node
 * onto the studio canvas.
 *
 * Acceptance criteria:
 * - When drag ends, flow callbacks are set for "evaluatorList"
 * - onSelect callback updates node with evaluator data and closes drawer
 * - onCreateNew callback opens evaluatorCategorySelector
 * - onClose callback deletes the pending placeholder node
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "../../types/dsl";
import type { NodeWithOptionalPosition } from "~/types";

// Mock useWorkflowStore
const mockSetNode = vi.fn();
const mockDeleteNode = vi.fn();
const mockSetSelectedNode = vi.fn();
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn((selector: any) =>
    selector({
      setNode: mockSetNode,
      deleteNode: mockDeleteNode,
      setSelectedNode: mockSetSelectedNode,
    }),
  ),
}));

// Mock useDrawer
const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();
const mockSetFlowCallbacks = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
    canGoBack: false,
    drawerOpen: vi.fn(() => false),
  }),
  setFlowCallbacks: (...args: unknown[]) => mockSetFlowCallbacks(...args),
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
  getFlowCallbacks: () => ({}),
}));

// Mock AVAILABLE_EVALUATORS for computeFieldsFromEvaluatorType
vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {
    "langevals/exact_match": {
      name: "Exact Match",
      requiredFields: ["output", "expected_output"],
      optionalFields: [],
      result: {
        passed: { description: "True if output matches expected" },
      },
    },
    "legacy/ragas_answer_relevancy": {
      name: "Answer Relevancy",
      requiredFields: ["input", "output"],
      optionalFields: ["contexts"],
      result: {
        score: { description: "Relevancy score" },
      },
    },
  },
}));

import { useEvaluatorPickerFlow } from "../useEvaluatorPickerFlow";

/**
 * Creates a mock node item as produced by the drag system
 */
const createMockDragItem = (
  nodeId: string,
): { node: NodeWithOptionalPosition<Component> } => ({
  node: {
    id: nodeId,
    type: "evaluator",
    data: {
      name: "Evaluator",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  },
});

describe("useEvaluatorPickerFlow()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when drag ends", () => {
    it("sets flow callbacks for evaluatorList", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "evaluatorList",
        expect.objectContaining({
          onSelect: expect.any(Function),
          onCreateNew: expect.any(Function),
          onClose: expect.any(Function),
        }),
      );
    });

    it("opens the evaluatorList drawer with resetStack", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
        vi.runAllTimers();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "evaluatorList",
        undefined,
        { resetStack: true },
      );
    });

    it("stores the pending node id in the ref", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      expect(result.current.pendingEvaluatorRef.current).toBe("eval_1");
    });
  });

  describe("when onSelect is called", () => {
    it("updates the node with evaluator name, ref, inputs from fields, and outputs from outputFields", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      // Extract the onSelect callback
      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (evaluator: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "custom-eval-id",
          name: "My Custom Evaluator",
          fields: [
            { identifier: "input", type: "str" },
            { identifier: "context", type: "str", optional: true },
          ],
          outputFields: [
            { identifier: "score", type: "float" },
          ],
        });
      });

      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "eval_1",
          data: expect.objectContaining({
            name: "My Custom Evaluator",
            evaluator: "evaluators/custom-eval-id",
            inputs: [
              { identifier: "input", type: "str" },
              { identifier: "context", type: "str", optional: true },
            ],
            outputs: [
              { identifier: "score", type: "float" },
            ],
          }),
        }),
      );
    });

    it("closes the drawer", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (evaluator: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "custom-eval-id",
          name: "My Custom Evaluator",
          fields: [],
          outputFields: [],
        });
      });

      expect(mockCloseDrawer).toHaveBeenCalled();
    });

    it("clears the pending ref", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (evaluator: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "custom-eval-id",
          name: "My Custom Evaluator",
          fields: [],
          outputFields: [],
        });
      });

      expect(result.current.pendingEvaluatorRef.current).toBeNull();
    });

    it("calls setSelectedNode", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (evaluator: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "custom-eval-id",
          name: "My Custom Evaluator",
          fields: [],
          outputFields: [],
        });
      });

      expect(mockSetSelectedNode).toHaveBeenCalledWith("eval_1");
    });
  });

  describe("when onClose is called (cancel)", () => {
    it("deletes the pending placeholder node", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onClose: () => void;
      };

      act(() => {
        callbacks.onClose();
      });

      expect(mockDeleteNode).toHaveBeenCalledWith("eval_1");
    });

    it("clears the pending ref", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onClose: () => void;
      };

      act(() => {
        callbacks.onClose();
      });

      expect(result.current.pendingEvaluatorRef.current).toBeNull();
    });

    it("closes the drawer", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onClose: () => void;
      };

      act(() => {
        callbacks.onClose();
      });

      expect(mockCloseDrawer).toHaveBeenCalled();
    });

    it("does not delete a node if ref was already cleared", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (evaluator: any) => void;
        onClose: () => void;
      };

      // First select (clears ref)
      act(() => {
        callbacks.onSelect({
          id: "custom-eval-id",
          name: "My Custom Evaluator",
          fields: [],
          outputFields: [],
        });
      });

      mockDeleteNode.mockClear();

      // Then close — ref is already null, so no deletion
      act(() => {
        callbacks.onClose();
      });

      expect(mockDeleteNode).not.toHaveBeenCalled();
    });
  });

  describe("when onCreateNew is called", () => {
    it("opens the evaluatorCategorySelector", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      act(() => {
        callbacks.onCreateNew();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("evaluatorCategorySelector");
    });

    it("sets flow callbacks for evaluatorEditor and workflowSelectorForEvaluator", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      mockSetFlowCallbacks.mockClear();

      act(() => {
        callbacks.onCreateNew();
      });

      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "evaluatorEditor",
        expect.objectContaining({ onSave: expect.any(Function) }),
      );
      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "workflowSelectorForEvaluator",
        expect.objectContaining({ onSave: expect.any(Function) }),
      );
    });

    it("wires onSave to update the pending node and select it", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const listCallbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      mockSetFlowCallbacks.mockClear();

      act(() => {
        listCallbacks.onCreateNew();
      });

      // Get the evaluatorEditor onSave callback
      const editorCallbacks = mockSetFlowCallbacks.mock.calls.find(
        (call: unknown[]) => call[0] === "evaluatorEditor",
      )![1] as { onSave: (saved: { id: string; name: string }) => void };

      act(() => {
        editorCallbacks.onSave({
          id: "new-eval-id",
          name: "New Evaluator",
        });
      });

      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "eval_1",
          data: expect.objectContaining({
            name: "New Evaluator",
            evaluator: "evaluators/new-eval-id",
          }),
        }),
      );
      expect(mockSetSelectedNode).toHaveBeenCalledWith("eval_1");
      expect(mockCloseDrawer).toHaveBeenCalled();
      expect(result.current.pendingEvaluatorRef.current).toBeNull();
    });

    it("computes inputs and outputs from evaluatorType when provided", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const listCallbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      mockSetFlowCallbacks.mockClear();

      act(() => {
        listCallbacks.onCreateNew();
      });

      const editorCallbacks = mockSetFlowCallbacks.mock.calls.find(
        (call: unknown[]) => call[0] === "evaluatorEditor",
      )![1] as {
        onSave: (saved: {
          id: string;
          name: string;
          evaluatorType?: string;
        }) => void;
      };

      act(() => {
        editorCallbacks.onSave({
          id: "new-eval-id",
          name: "Exact Match",
          evaluatorType: "langevals/exact_match",
        });
      });

      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "eval_1",
          data: expect.objectContaining({
            name: "Exact Match",
            evaluator: "evaluators/new-eval-id",
            inputs: [
              { identifier: "output", type: "str" },
              { identifier: "expected_output", type: "str" },
            ],
            outputs: [
              { identifier: "passed", type: "bool" },
              { identifier: "details", type: "str" },
            ],
          }),
        }),
      );
    });

    it("computes score-based outputs for ragas evaluator type", () => {
      const { result } = renderHook(() => useEvaluatorPickerFlow());

      act(() => {
        result.current.handleEvaluatorDragEnd(createMockDragItem("eval_1"));
      });

      const listCallbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      mockSetFlowCallbacks.mockClear();

      act(() => {
        listCallbacks.onCreateNew();
      });

      const editorCallbacks = mockSetFlowCallbacks.mock.calls.find(
        (call: unknown[]) => call[0] === "evaluatorEditor",
      )![1] as {
        onSave: (saved: {
          id: string;
          name: string;
          evaluatorType?: string;
        }) => void;
      };

      act(() => {
        editorCallbacks.onSave({
          id: "ragas-eval-id",
          name: "Answer Relevancy",
          evaluatorType: "legacy/ragas_answer_relevancy",
        });
      });

      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "eval_1",
          data: expect.objectContaining({
            inputs: [
              { identifier: "input", type: "str" },
              { identifier: "output", type: "str" },
              { identifier: "contexts", type: "list", optional: true },
            ],
            outputs: [
              { identifier: "score", type: "float" },
              { identifier: "details", type: "str" },
            ],
          }),
        }),
      );
    });
  });
});
