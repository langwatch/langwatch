/**
 * @vitest-environment jsdom
 *
 * Unit tests for usePromptPickerFlow hook.
 * Tests the prompt picker flow triggered after drag-dropping a Prompt node
 * onto the studio canvas.
 *
 * Acceptance criteria:
 * - When drag ends, flow callbacks are set for "promptList"
 * - onSelect callback updates node with prompt data and closes drawer
 * - onCreateNew callback clears pending ref without deleting node
 * - onClose callback deletes the pending placeholder node
 * - Registry label is "Prompt" (not "LLM Node")
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

import { usePromptPickerFlow } from "../usePromptPickerFlow";
import { MODULES } from "../../registry";

/**
 * Creates a mock node item as produced by the drag system
 */
const createMockDragItem = (
  nodeId: string,
): { node: NodeWithOptionalPosition<Component> } => ({
  node: {
    id: nodeId,
    type: "signature",
    data: {
      name: "Prompt",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  },
});

describe("usePromptPickerFlow()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when drag ends", () => {
    it("sets flow callbacks for promptList", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "promptList",
        expect.objectContaining({
          onSelect: expect.any(Function),
          onCreateNew: expect.any(Function),
          onClose: expect.any(Function),
        }),
      );
    });

    it("opens the promptList drawer with resetStack", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
        vi.runAllTimers();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "promptList",
        undefined,
        { resetStack: true },
      );
    });

    it("stores the pending node id in the ref", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      expect(result.current.pendingPromptRef.current).toBe("prompt_1");
    });
  });

  describe("when onSelect is called", () => {
    it("updates the placeholder node with prompt data", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      // Extract the onSelect callback
      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (prompt: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "saved-prompt-id",
          name: "My Saved Prompt",
          version: 3,
          versionId: "version-abc",
          inputs: [{ identifier: "question", type: "str" }],
          outputs: [{ identifier: "answer", type: "str" }],
        });
      });

      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "prompt_1",
          data: expect.objectContaining({
            name: "My Saved Prompt",
            configId: "saved-prompt-id",
            versionMetadata: expect.objectContaining({
              versionId: "version-abc",
              versionNumber: 3,
            }),
            inputs: [{ identifier: "question", type: "str" }],
            outputs: [{ identifier: "answer", type: "str" }],
          }),
        }),
      );
    });

    it("closes the drawer", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (prompt: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "saved-prompt-id",
          name: "My Saved Prompt",
        });
      });

      expect(mockCloseDrawer).toHaveBeenCalled();
    });

    it("clears the pending ref", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (prompt: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "saved-prompt-id",
          name: "My Saved Prompt",
        });
      });

      expect(result.current.pendingPromptRef.current).toBeNull();
    });

    it("selects the node so the prompt editor opens", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (prompt: any) => void;
      };

      act(() => {
        callbacks.onSelect({
          id: "saved-prompt-id",
          name: "My Saved Prompt",
        });
      });

      expect(mockSetSelectedNode).toHaveBeenCalledWith("prompt_1");
    });
  });

  describe("when onCreateNew is called", () => {
    it("clears the pending ref without deleting the node", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      act(() => {
        callbacks.onCreateNew();
      });

      expect(result.current.pendingPromptRef.current).toBeNull();
      expect(mockDeleteNode).not.toHaveBeenCalled();
    });

    it("closes the drawer", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      act(() => {
        callbacks.onCreateNew();
      });

      expect(mockCloseDrawer).toHaveBeenCalled();
    });

    it("selects the node so the prompt editor opens", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      act(() => {
        callbacks.onCreateNew();
      });

      expect(mockSetSelectedNode).toHaveBeenCalledWith("prompt_1");
    });
  });

  describe("when onClose is called (cancel)", () => {
    it("deletes the pending placeholder node", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onClose: () => void;
      };

      act(() => {
        callbacks.onClose();
      });

      expect(mockDeleteNode).toHaveBeenCalledWith("prompt_1");
    });

    it("clears the pending ref", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onClose: () => void;
      };

      act(() => {
        callbacks.onClose();
      });

      expect(result.current.pendingPromptRef.current).toBeNull();
    });

    it("closes the drawer", () => {
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
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
      const { result } = renderHook(() => usePromptPickerFlow());

      act(() => {
        result.current.handlePromptDragEnd(createMockDragItem("prompt_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
        onClose: () => void;
      };

      // First create new (clears ref)
      act(() => {
        callbacks.onCreateNew();
      });

      mockDeleteNode.mockClear();

      // Then close should NOT delete since ref is already null
      act(() => {
        callbacks.onClose();
      });

      expect(mockDeleteNode).not.toHaveBeenCalled();
    });
  });
});

describe("Registry label", () => {
  it("names the signature module 'Prompt'", () => {
    expect(MODULES.signature.name).toBe("Prompt");
  });
});
