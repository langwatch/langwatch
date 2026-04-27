/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { WorkflowStore } from "../useWorkflowStore";
import type { StudioServerEvent } from "../../types/events";

// Mock toaster
vi.mock("../../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Mock logger
vi.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { useHandleServerMessage } from "../usePostEvent";

function createMockStore(
  overrides: Partial<WorkflowStore> = {},
): WorkflowStore {
  return {
    setSocketStatus: vi.fn(),
    getWorkflow: vi.fn().mockReturnValue({
      state: { execution: {} },
      nodes: [],
      edges: [],
    }),
    setComponentExecutionState: vi.fn(),
    setWorkflowExecutionState: vi.fn(),
    setEvaluationState: vi.fn(),
    setOptimizationState: vi.fn(),
    checkIfUnreachableErrorMessage: vi.fn(),
    stopWorkflowIfRunning: vi.fn(),
    setOpenResultsPanelRequest: vi.fn(),
    setSelectedNode: vi.fn(),
    setPropertiesExpanded: vi.fn(),
    ...overrides,
  } as unknown as WorkflowStore;
}

describe("useHandleServerMessage", () => {
  describe("when component_state_change completes", () => {
    it("does not auto-select the node (avoids jumping during multi-node workflows)", () => {
      const store = createMockStore();
      const alertOnComponent = vi.fn();

      const { result } = renderHook(() =>
        useHandleServerMessage({
          workflowStore: store,
          alertOnComponent,
        }),
      );

      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "node-1",
          execution_state: { status: "success" },
        },
      };

      result.current(event);

      expect(store.setSelectedNode).not.toHaveBeenCalled();
      expect(store.setPropertiesExpanded).not.toHaveBeenCalled();
    });
  });

  describe("when execution_state_change completes with until_node_id", () => {
    it("auto-selects the target node and expands properties", () => {
      const store = createMockStore({
        getWorkflow: vi.fn().mockReturnValue({
          state: {
            execution: { until_node_id: "llm-node-1" },
          },
          nodes: [],
          edges: [],
        }),
      } as unknown as Partial<WorkflowStore>);
      const alertOnComponent = vi.fn();

      const { result } = renderHook(() =>
        useHandleServerMessage({
          workflowStore: store,
          alertOnComponent,
        }),
      );

      const event: StudioServerEvent = {
        type: "execution_state_change",
        payload: {
          execution_state: { status: "success" },
        },
      };

      result.current(event);

      expect(store.setSelectedNode).toHaveBeenCalledWith("llm-node-1");
      expect(store.setPropertiesExpanded).toHaveBeenCalledWith(true);
    });

    it("does not auto-select when there is no until_node_id (full workflow run)", () => {
      const store = createMockStore();
      const alertOnComponent = vi.fn();

      const { result } = renderHook(() =>
        useHandleServerMessage({
          workflowStore: store,
          alertOnComponent,
        }),
      );

      const event: StudioServerEvent = {
        type: "execution_state_change",
        payload: {
          execution_state: { status: "success" },
        },
      };

      result.current(event);

      expect(store.setSelectedNode).not.toHaveBeenCalled();
      expect(store.setPropertiesExpanded).not.toHaveBeenCalled();
    });
  });
});
