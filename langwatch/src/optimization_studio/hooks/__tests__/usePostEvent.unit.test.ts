/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioServerEvent } from "../../types/events";
import type { WorkflowStore } from "../useWorkflowStore";

// Mock toaster
vi.mock("../../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Mock logger
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { toaster } from "../../../components/ui/toaster";
import { useHandleServerMessage } from "../usePostEvent";

const toastCreate = vi.mocked(toaster.create);

/** The toast `alertOnError` raised, or undefined if it never fired. */
function lastToast() {
  return toastCreate.mock.calls.at(-1)?.[0] as
    | {
        id?: string;
        title?: string;
        description?: string;
        type?: string;
      }
    | undefined;
}

function handleErroredExecution(
  executionState: Record<string, unknown>,
): ReturnType<typeof lastToast> {
  const { result } = renderHook(() =>
    useHandleServerMessage({
      workflowStore: createMockStore(),
      alertOnComponent: vi.fn(),
    }),
  );

  result.current({
    type: "execution_state_change",
    payload: { execution_state: { status: "error", ...executionState } },
  } as StudioServerEvent);

  return lastToast();
}

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
  beforeEach(() => {
    toastCreate.mockClear();
  });

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

/**
 * `alertOnError` decides what a failed run SAYS. Every branch of it — the
 * words, where they come from, whether the toast is red, and whether a second
 * failure replaces the first — is only observable through the toaster.
 */
describe("alertOnError", () => {
  beforeEach(() => {
    toastCreate.mockClear();
  });

  describe("given a coded failure", () => {
    it("uses the registry's copy, not the engine's message", () => {
      const toast = handleErroredExecution({
        error_type: "invalid_dataset",
        error:
          'dataset: column "expected_output" missing at /tmp/lw-run-9/rows.jsonl',
      });

      expect(toast?.type).toBe("error");
      expect(toast?.title).not.toContain("expected_output");
      expect(toast?.title).not.toContain("/tmp/");
      expect(toast?.description ?? "").not.toContain("/tmp/");
    });
  });

  describe("given an uncoded failure", () => {
    it("shows the message we do have rather than claiming we were notified", () => {
      const toast = handleErroredExecution({
        error: "Timeout",
      });

      expect(toast?.type).toBe("error");
      expect(toast?.description).toBe("Timeout");
    });

    it("caps a wall of Go so it cannot fill the toast", () => {
      const wall = "goroutine stack ".repeat(40);
      const toast = handleErroredExecution({ error: wall });

      expect(toast?.description).toBeDefined();
      expect(toast!.description!.length).toBeLessThan(wall.length);
      expect(toast!.description!.length).toBeLessThanOrEqual(160);
    });
  });

  describe("when two different uncoded failures arrive", () => {
    /**
     * The dedupe id is keyed on what the toast SAYS. Keying it on
     * `error_type` alone collapsed every uncoded failure onto one id, so the
     * second one silently replaced the first instead of stacking beside it.
     */
    it("gives them two toast ids", () => {
      handleErroredExecution({ error: "Timeout" });
      const first = lastToast()?.id;
      handleErroredExecution({ error: "Connection reset" });
      const second = lastToast()?.id;

      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first).not.toBe(second);
    });
  });

  describe("when two failures share a code the registry has no copy for", () => {
    /**
     * `engine.go` forwards the code runner's own error type, so two unrelated
     * Python failures can arrive under the same unregistered code. They
     * present from their raw messages, so they must not share a toast id.
     */
    it("gives them two toast ids", () => {
      handleErroredExecution({
        error_type: "ValueError",
        error: "invalid literal for int() with base 10: 'abc'",
      });
      const first = lastToast()?.id;
      handleErroredExecution({
        error_type: "ValueError",
        error: "could not convert string to float: 'x'",
      });
      const second = lastToast()?.id;

      expect(first).not.toBe(second);
    });
  });

  describe("when the run was deliberately cancelled", () => {
    /**
     * The engine emits `context_canceled`, which matches neither of the words
     * the prose fallback looks for — so pressing Stop used to raise a red
     * "something went wrong".
     */
    it("does not toast the cancel as an error", () => {
      const toast = handleErroredExecution({
        error_type: "context_canceled",
        error: "context canceled",
      });

      expect(toast?.type).toBe("info");
      expect(toast?.title).toBe("Stopped");
    });

    it("still recognises a stop announced only in prose", () => {
      const toast = handleErroredExecution({
        error: "Execution was stopped by the user",
      });

      expect(toast?.type).toBe("info");
      expect(toast?.title).toBe("Stopped");
    });
  });
});
