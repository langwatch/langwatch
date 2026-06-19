/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StudioServerEvent } from "../../types/events";
import type { WorkflowStore } from "../useWorkflowStore";

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

  describe("given run-until-here ends in error", () => {
    describe("when one upstream node carries the error", () => {
      /** @scenario An errored run opens the node that failed */
      it("selects the failing node instead of the run target", () => {
        const store = createMockStore({
          getWorkflow: vi.fn().mockReturnValue({
            state: { execution: { until_node_id: "end-node" } },
            nodes: [
              { id: "end-node", data: {} },
              {
                id: "llm-node",
                data: {
                  execution_state: {
                    status: "error",
                    error: "Invalid messages",
                  },
                },
              },
            ],
            edges: [],
          }),
        } as unknown as Partial<WorkflowStore>);

        const { result } = renderHook(() =>
          useHandleServerMessage({
            workflowStore: store,
            alertOnComponent: vi.fn(),
          }),
        );

        result.current({
          type: "execution_state_change",
          payload: {
            execution_state: { status: "error", error: "Invalid messages" },
          },
        } as StudioServerEvent);

        expect(store.setSelectedNode).toHaveBeenCalledWith("llm-node");
        expect(store.setSelectedNode).not.toHaveBeenCalledWith("end-node");
        expect(store.setPropertiesExpanded).toHaveBeenCalledWith(true);
      });
    });

    describe("when no single node carries the error", () => {
      it("falls back to the run target", () => {
        const store = createMockStore({
          getWorkflow: vi.fn().mockReturnValue({
            state: { execution: { until_node_id: "end-node" } },
            nodes: [{ id: "end-node", data: {} }],
            edges: [],
          }),
        } as unknown as Partial<WorkflowStore>);

        const { result } = renderHook(() =>
          useHandleServerMessage({
            workflowStore: store,
            alertOnComponent: vi.fn(),
          }),
        );

        result.current({
          type: "execution_state_change",
          payload: { execution_state: { status: "error", error: "boom" } },
        } as StudioServerEvent);

        expect(store.setSelectedNode).toHaveBeenCalledWith("end-node");
      });
    });
  });
});
