/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentWithFields } from "@langwatch/agent-contract";
import type { EvaluatorWithFields } from "@langwatch/evaluator-contract";
import type { Component, NodeWithOptionalPosition } from "@langwatch/workflow-contract";

import {
  type AgentPickerCallbacks,
  type AgentPickerPort,
  useWorkflowAgentPickerFlow,
} from "../use-workflow-agent-picker-flow";
import {
  type EvaluatorPickerCallbacks,
  type EvaluatorPickerPort,
  useWorkflowEvaluatorPickerFlow,
} from "../use-workflow-evaluator-picker-flow";
import {
  type PromptPickerCallbacks,
  type PromptPickerPort,
  useWorkflowPromptPickerFlow,
} from "../use-workflow-prompt-picker-flow";

const { storeActions } = vi.hoisted(() => ({
  storeActions: {
    setNode: vi.fn(),
    deleteNode: vi.fn(),
    setSelectedNode: vi.fn(),
  },
}));

vi.mock("../use-workflow-store", () => ({
  useWorkflowStore: (selector: (state: typeof storeActions) => unknown) =>
    selector(storeActions),
}));

const dragItem = {
  node: {
    id: "node-1",
    type: "signature",
    data: { name: "Dropped node" },
  } satisfies NodeWithOptionalPosition<Component>,
};

function mountHook<T>(hook: () => T) {
  let value: T | undefined;
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    value = hook();
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    getValue: () => {
      if (value === void 0) {
        throw new Error("hook did not render");
      }
      return value;
    },
    unmount: () => act(() => root.unmount()),
  };
}

const evaluator = {
  id: "evaluator-1",
  projectId: "project-1",
  name: "Exact match",
  slug: null,
  type: "evaluator",
  config: null,
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  fields: [{ identifier: "output", type: "str" }],
  outputFields: [{ identifier: "passed", type: "bool" }],
} satisfies EvaluatorWithFields;

const agent = {
  id: "agent-1",
  projectId: "project-1",
  name: "HTTP agent",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  type: "http",
  config: { url: "https://example.com", method: "GET" },
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
} satisfies AgentWithFields;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Workflow prompt picker flow", () => {
  it("updates and selects a dropped node, while the app port owns drawer effects", () => {
    let callbacks: PromptPickerCallbacks | undefined;
    const port: PromptPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      open: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowPromptPickerFlow(port));
    const result = mounted.getValue();

    act(() => result.handlePromptDragEnd(dragItem));
    act(() => {
      callbacks?.onSelect({
        id: "prompt-1",
        name: "Question prompt",
        version: 3,
        versionId: "version-3",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      });
    });

    expect(storeActions.setNode).toHaveBeenCalledWith(
      expect.objectContaining({ id: "node-1" }),
    );
    expect(storeActions.setSelectedNode).toHaveBeenCalledWith("node-1");
    expect(port.open).toHaveBeenCalled();
    expect(port.close).toHaveBeenCalled();
    mounted.unmount();
  });

  it("clears and selects the placeholder when creating a new prompt", () => {
    let callbacks: PromptPickerCallbacks | undefined;
    const port: PromptPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      open: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowPromptPickerFlow(port));

    act(() => mounted.getValue().handlePromptDragEnd(dragItem));
    act(() => callbacks?.onCreateNew());

    expect(storeActions.deleteNode).not.toHaveBeenCalled();
    expect(storeActions.setSelectedNode).toHaveBeenCalledWith("node-1");
    expect(port.close).toHaveBeenCalled();
    mounted.unmount();
  });

  it("deletes a cancelled prompt placeholder", () => {
    let callbacks: PromptPickerCallbacks | undefined;
    const port: PromptPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      open: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowPromptPickerFlow(port));

    act(() => mounted.getValue().handlePromptDragEnd(dragItem));
    act(() => callbacks?.onClose());

    expect(storeActions.deleteNode).toHaveBeenCalledWith("node-1");
    expect(port.close).toHaveBeenCalled();
    mounted.unmount();
  });
});

describe("Workflow evaluator picker flow", () => {
  it("maps selected evaluator fields and removes a cancelled placeholder", () => {
    let callbacks: EvaluatorPickerCallbacks | undefined;
    const port: EvaluatorPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      registerCreation: vi.fn(),
      openList: vi.fn(),
      openCategory: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowEvaluatorPickerFlow(port));
    const result = mounted.getValue();

    act(() => result.handleEvaluatorDragEnd(dragItem));
    act(() => callbacks?.onSelect(evaluator));
    expect(storeActions.setNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "node-1",
        data: expect.objectContaining({ evaluator: "evaluators/evaluator-1" }),
      }),
    );

    act(() => result.handleEvaluatorDragEnd(dragItem));
    act(() => callbacks?.onClose());
    expect(storeActions.deleteNode).toHaveBeenCalledWith("node-1");
    mounted.unmount();
  });

  it("opens evaluator creation and applies the default output shape", () => {
    let callbacks: EvaluatorPickerCallbacks | undefined;
    let onSave:
      | ((saved: { id: string; name: string; evaluatorType?: string }) => boolean | void)
      | undefined;
    const port: EvaluatorPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      registerCreation: (callback) => {
        onSave = callback;
      },
      openList: vi.fn(),
      openCategory: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowEvaluatorPickerFlow(port));

    act(() => mounted.getValue().handleEvaluatorDragEnd(dragItem));
    act(() => callbacks?.onCreateNew());

    expect(onSave).toBeTypeOf("function");
    expect(port.openCategory).toHaveBeenCalled();
    act(() => onSave?.({ id: "evaluator-2", name: "New evaluator" }));

    expect(storeActions.setNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "node-1",
        data: expect.objectContaining({
          inputs: [],
          outputs: [{ identifier: "passed", type: "bool" }],
        }),
      }),
    );
    expect(port.close).toHaveBeenCalled();
    mounted.unmount();
  });

  it("derives the declared fields for a newly created evaluator", () => {
    let callbacks: EvaluatorPickerCallbacks | undefined;
    let onSave:
      | ((saved: { id: string; name: string; evaluatorType?: string }) => boolean | void)
      | undefined;
    const port: EvaluatorPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      registerCreation: (callback) => {
        onSave = callback;
      },
      openList: vi.fn(),
      openCategory: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowEvaluatorPickerFlow(port));

    act(() => mounted.getValue().handleEvaluatorDragEnd(dragItem));
    act(() => callbacks?.onCreateNew());
    act(() =>
      onSave?.({
        id: "evaluator-2",
        name: "Exact match",
        evaluatorType: "langevals/exact_match",
      }),
    );

    expect(storeActions.setNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "node-1",
        data: expect.objectContaining({
          inputs: [
            { identifier: "output", type: "str", optional: true },
            { identifier: "expected_output", type: "str", optional: true },
          ],
          outputs: [{ identifier: "passed", type: "bool" }],
        }),
      }),
    );
    mounted.unmount();
  });
});

describe("Workflow agent picker flow", () => {
  it("maps a selected agent and registers app-owned creation effects", () => {
    let callbacks: AgentPickerCallbacks | undefined;
    const registerCreation = vi.fn();
    const port: AgentPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      registerCreation,
      openList: vi.fn(),
      openTypeSelector: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowAgentPickerFlow(port));
    const result = mounted.getValue();

    act(() => result.handleAgentDragEnd(dragItem));
    act(() => callbacks?.onSelect(agent));
    expect(storeActions.setNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "node-1",
        data: expect.objectContaining({
          agent: "agents/agent-1",
          parameters: expect.arrayContaining([
            { identifier: "agent_type", type: "str", value: "http" },
            { identifier: "url", type: "str", value: "https://example.com" },
            { identifier: "method", type: "str", value: "GET" },
          ]),
        }),
      }),
    );

    act(() => result.handleAgentDragEnd(dragItem));
    act(() => callbacks?.onCreateNew());
    expect(registerCreation).toHaveBeenCalledWith(expect.any(Function));
    mounted.unmount();
  });

  it("opens agent creation and removes a cancelled placeholder", () => {
    let callbacks: AgentPickerCallbacks | undefined;
    const port: AgentPickerPort = {
      register: (registered) => {
        callbacks = registered;
      },
      registerCreation: vi.fn(),
      openList: vi.fn(),
      openTypeSelector: vi.fn(),
      close: vi.fn(),
    };
    const mounted = mountHook(() => useWorkflowAgentPickerFlow(port));

    act(() => mounted.getValue().handleAgentDragEnd(dragItem));
    act(() => callbacks?.onCreateNew());
    expect(port.openTypeSelector).toHaveBeenCalled();

    act(() => callbacks?.onClose());
    expect(storeActions.deleteNode).toHaveBeenCalledWith("node-1");
    expect(port.close).toHaveBeenCalled();
    mounted.unmount();
  });
});
