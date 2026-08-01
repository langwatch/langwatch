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
    /**
     * ADR-045 §3: an unhandled failure's raw detail is logged with the trace
     * id, never presented. The engine's message is arbitrary text — it can
     * name a URL, a temp path or a Go net error — so the toast says what we
     * were doing and nothing we cannot vouch for. The message is still in the
     * node properties panel for whoever is debugging.
     */
    it("names the action instead of quoting the engine", () => {
      const toast = handleErroredExecution({
        error: "Timeout",
      });

      expect(toast?.type).toBe("error");
      expect(toast?.title).toBe("This run didn't finish");
      expect(toast?.description ?? "").not.toContain("Timeout");
    });

    it("keeps a wall of Go out of the toast entirely", () => {
      const wall = "goroutine stack ".repeat(40);
      const toast = handleErroredExecution({ error: wall });

      expect(toast?.description ?? "").not.toContain("goroutine");
      expect(toast?.title).not.toContain("goroutine");
    });

    /**
     * "We've been notified" has to be true when we say it. A failure with no
     * trace id has no log line behind it — the studio's own client-side
     * timeout, for one — so the toast makes no promise nobody kept.
     */
    it("only claims we were notified when there is a trace to be notified by", () => {
      const untraced = handleErroredExecution({ error: "Timeout" });
      expect(untraced?.description ?? "").toBe("");

      const traced = handleErroredExecution({
        error: "Timeout",
        trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
      expect(traced?.description ?? "").toContain("notified");
    });
  });

  describe("when two uncoded failures arrive", () => {
    /**
     * The dedupe id is keyed on what the toast SAYS, and two failures we could
     * not name say the same thing — so they are one toast, not two identical
     * ones stacked. A failure the registry HAS copy for still keys on its own
     * code, so it never collapses onto an unrelated one.
     */
    it("shows one toast, not two identical ones", () => {
      handleErroredExecution({ error: "Timeout" });
      const first = lastToast()?.id;
      handleErroredExecution({ error: "Connection reset" });
      const second = lastToast()?.id;

      expect(first).toBeDefined();
      expect(first).toBe(second);
    });

    it("keeps a named failure on its own toast", () => {
      handleErroredExecution({ error: "Timeout" });
      const unnamed = lastToast()?.id;
      handleErroredExecution({
        error_type: "invalid_dataset",
        error: "dataset: column missing",
      });
      const named = lastToast()?.id;

      expect(named).not.toBe(unnamed);
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
