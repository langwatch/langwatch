/**
 * @vitest-environment jsdom
 *
 * Unit tests for useAgentPickerFlow hook.
 * Tests the agent picker flow triggered after drag-dropping an Agent node
 * onto the studio canvas.
 *
 * Acceptance criteria:
 * - When drag ends, flow callbacks are set for "agentList"
 * - onSelect callback updates node with agent data and closes drawer
 * - onCreateNew callback opens agentTypeSelector
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

import { useAgentPickerFlow } from "../useAgentPickerFlow";

/**
 * Creates a mock node item as produced by the drag system
 */
const createMockDragItem = (
  nodeId: string,
): { node: NodeWithOptionalPosition<Component> } => ({
  node: {
    id: nodeId,
    type: "agent",
    data: {
      name: "Agent",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  },
});

/**
 * Creates a mock TypedAgent as returned by the agent repository
 */
const createMockAgent = () => ({
  id: "agent-123",
  name: "My Agent",
  type: "http" as const,
  config: {
    url: "https://example.com",
    method: "POST",
  },
});

describe("useAgentPickerFlow()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when drag ends", () => {
    it("sets flow callbacks for agentList", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "agentList",
        expect.objectContaining({
          onSelect: expect.any(Function),
          onCreateNew: expect.any(Function),
          onClose: expect.any(Function),
        }),
      );
    });

    it("opens the agentList drawer with resetStack", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
        vi.runAllTimers();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "agentList",
        undefined,
        { resetStack: true },
      );
    });

    it("stores the pending node id in the ref", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      expect(result.current.pendingAgentRef.current).toBe("agent_1");
    });
  });

  describe("when onSelect is called", () => {
    it("updates the placeholder node with agent name, ref, type, inputs, outputs, parameters", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (agent: any) => void;
      };

      act(() => {
        callbacks.onSelect(createMockAgent());
      });

      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agent_1",
          data: expect.objectContaining({
            name: "My Agent",
            agent: "agents/agent-123",
            agentType: "http",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            parameters: expect.arrayContaining([
              { identifier: "agent_type", type: "str", value: "http" },
              { identifier: "url", type: "str", value: "https://example.com" },
              { identifier: "method", type: "str", value: "POST" },
            ]),
          }),
        }),
      );
    });

    it("closes the drawer", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (agent: any) => void;
      };

      act(() => {
        callbacks.onSelect(createMockAgent());
      });

      expect(mockCloseDrawer).toHaveBeenCalled();
    });

    it("clears the pending ref", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (agent: any) => void;
      };

      act(() => {
        callbacks.onSelect(createMockAgent());
      });

      expect(result.current.pendingAgentRef.current).toBeNull();
    });

    it("calls setSelectedNode", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (agent: any) => void;
      };

      act(() => {
        callbacks.onSelect(createMockAgent());
      });

      expect(mockSetSelectedNode).toHaveBeenCalledWith("agent_1");
    });
  });

  describe("when onClose is called (cancel)", () => {
    it("deletes the pending placeholder node", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onClose: () => void;
      };

      act(() => {
        callbacks.onClose();
      });

      expect(mockDeleteNode).toHaveBeenCalledWith("agent_1");
    });

    it("clears the pending ref", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onClose: () => void;
      };

      act(() => {
        callbacks.onClose();
      });

      expect(result.current.pendingAgentRef.current).toBeNull();
    });

    it("closes the drawer", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
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
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onSelect: (agent: any) => void;
        onClose: () => void;
      };

      // First select (clears ref)
      act(() => {
        callbacks.onSelect(createMockAgent());
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
    it("opens agentTypeSelector", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      act(() => {
        callbacks.onCreateNew();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("agentTypeSelector");
    });

    it("sets flow callbacks for agentHttpEditor, agentCodeEditor, and workflowSelector", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const callbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      mockSetFlowCallbacks.mockClear();

      act(() => {
        callbacks.onCreateNew();
      });

      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "agentHttpEditor",
        expect.objectContaining({ onSave: expect.any(Function) }),
      );
      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "agentCodeEditor",
        expect.objectContaining({ onSave: expect.any(Function) }),
      );
      expect(mockSetFlowCallbacks).toHaveBeenCalledWith(
        "workflowSelector",
        expect.objectContaining({ onSave: expect.any(Function) }),
      );
    });

    it("wires onSave to update the pending node with agent data and select it", () => {
      const { result } = renderHook(() => useAgentPickerFlow());

      act(() => {
        result.current.handleAgentDragEnd(createMockDragItem("agent_1"));
      });

      const listCallbacks = mockSetFlowCallbacks.mock.calls[0]![1] as {
        onCreateNew: () => void;
      };

      mockSetFlowCallbacks.mockClear();

      act(() => {
        listCallbacks.onCreateNew();
      });

      // Get the agentHttpEditor onSave callback
      const editorCallbacks = mockSetFlowCallbacks.mock.calls.find(
        (call: unknown[]) => call[0] === "agentHttpEditor",
      )![1] as { onSave: (agent: any) => void };

      act(() => {
        editorCallbacks.onSave({
          id: "new-agent-id",
          name: "New Agent",
          type: "http",
          config: {
            url: "https://example.com",
            method: "POST",
          },
        });
      });

      expect(mockSetNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agent_1",
          data: expect.objectContaining({
            name: "New Agent",
            agent: "agents/new-agent-id",
            agentType: "http",
          }),
        }),
      );
      expect(mockSetSelectedNode).toHaveBeenCalledWith("agent_1");
      expect(mockCloseDrawer).toHaveBeenCalled();
      expect(result.current.pendingAgentRef.current).toBeNull();
    });
  });
});
