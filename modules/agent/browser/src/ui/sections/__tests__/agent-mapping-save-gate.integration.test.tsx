import type { AgentInputBinding } from "@langwatch/agent-contract";
import { buildCodeConfig } from "@langwatch/agent-contract/code-config";
/**
 * @vitest-environment jsdom
 * @see specs/features/scenarios/minimal-input-mapping.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentBrowser } from "../../../model/agent-client.ts";
import {
  AgentCodeEditorDrawer,
  type AgentCodeEditorDrawerProps,
} from "../agent-code-editor-drawer.tsx";
import {
  AgentWorkflowEditorDrawer,
  type AgentWorkflowEditorDrawerProps,
} from "../agent-workflow-editor-drawer.tsx";

const inputMapping = {
  message: { type: "source" as const, sourceId: "scenario", path: ["input"] },
};
const threadIdOnly = {
  message: { type: "source" as const, sourceId: "scenario", path: ["threadId"] },
};

afterEach(() => cleanup());

function workflowEditor(overrides: Partial<AgentWorkflowEditorDrawerProps>) {
  let clearOutput: (field: string | undefined) => void = () => {};
  const props: AgentWorkflowEditorDrawerProps = {
    open: true,
    agent: {
      id: "agent-1",
      name: "Workflow agent",
      config: { workflow_id: "workflow-1", scenarioMappings: inputMapping },
    },
    isLoading: false,
    isSaving: false,
    workflowInputs: [{ identifier: "message", type: "str" }],
    workflowOutputs: [{ identifier: "result", type: "str" }],
    defaultMappings: {},
    renderMappings: (mapping) => {
      clearOutput = (field) => mapping.onOutputFieldChange(field);
      return null;
    },
    onUpdate: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  renderWithDesignSystem(<AgentWorkflowEditorDrawer {...props} />);
  return { clearOutput: () => act(() => clearOutput(undefined)) };
}

function codeAgent(scenarioMappings: Record<string, AgentInputBinding>): AgentBrowser {
  return {
    id: "agent-code",
    projectId: "project_1",
    name: "Code agent",
    type: "code",
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    copyCount: 0,
    config: buildCodeConfig({
      code: "def run(message):\n    return message",
      inputs: [{ identifier: "message", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      scenarioMappings,
    }),
    inputFields: [],
    outputFields: [],
    fieldsResolved: true,
  };
}

function codeEditor(agent: AgentBrowser) {
  let clearOutput: (field: string | undefined) => void = () => {};
  const props: AgentCodeEditorDrawerProps = {
    open: true,
    agentId: agent.id,
    agent,
    projectId: "project_1",
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onError: vi.fn(),
    renderCodeEditor: () => null,
    renderCodeModal: () => null,
    renderInputs: () => null,
    renderOutputs: () => null,
    renderMappings: (mapping) => {
      clearOutput = (field) => mapping.onOutputFieldChange(field);
      return null;
    },
    renderTestPanel: () => null,
  };
  renderWithDesignSystem(<AgentCodeEditorDrawer {...props} />);
  return { clearOutput: () => act(() => clearOutput(undefined)) };
}

const saveButton = () => screen.getByTestId("save-agent-button");

describe("the workflow agent editor's save gate", () => {
  /** @scenario "Save workflow agent when output mapping is cleared but input mapping present" */
  it("saves with an input mapping and a cleared output field", () => {
    const { clearOutput } = workflowEditor({});
    clearOutput();

    expect(saveButton()).toBeEnabled();
  });

  /** @scenario "Save workflow agent stays blocked when the workflow has no published outputs" */
  it("stays blocked when the workflow publishes no end output", () => {
    workflowEditor({ workflowOutputs: [] });

    expect(saveButton()).toBeDisabled();
  });

  /** @scenario "Save workflow agent stays blocked when no input mapping is configured" */
  it("stays blocked with only a threadId mapping", () => {
    workflowEditor({
      agent: {
        id: "agent-1",
        name: "Workflow agent",
        config: { workflow_id: "workflow-1", scenarioMappings: threadIdOnly },
      },
    });

    expect(saveButton()).toBeDisabled();
  });
});

describe("the code agent editor's save gate", () => {
  /** @scenario "Save code agent when output mapping is cleared but input mapping present" */
  it("saves with an input mapping and a cleared output field", () => {
    const { clearOutput } = codeEditor(codeAgent(inputMapping));
    clearOutput();

    expect(saveButton()).toBeEnabled();
  });

  /** @scenario "Save code agent stays blocked when no input mapping is configured" */
  it("stays blocked with only a threadId mapping", () => {
    codeEditor(codeAgent(threadIdOnly));

    expect(saveButton()).toBeDisabled();
  });
});
