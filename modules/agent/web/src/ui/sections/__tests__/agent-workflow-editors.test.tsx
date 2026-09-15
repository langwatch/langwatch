// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentWorkflowEditorDrawer,
  type AgentWorkflowEditorDrawerProps,
} from "../agent-workflow-editor-drawer.tsx";
import { AgentWorkflowTargetEditorDrawer } from "../agent-workflow-target-editor-drawer.tsx";

const agent = {
  id: "agent-1",
  name: "Workflow agent",
  config: {
    workflow_id: "workflow-1",
    scenarioMappings: {
      message: { type: "source" as const, sourceId: "scenario", path: ["input"] },
    },
  },
};

function editor(overrides: Partial<AgentWorkflowEditorDrawerProps> = {}) {
  const props: AgentWorkflowEditorDrawerProps = {
    open: true,
    agent,
    isLoading: false,
    isSaving: false,
    workflowInputs: [{ identifier: "message", type: "str" }],
    workflowOutputs: [{ identifier: "result", type: "str" }],
    defaultMappings: {},
    renderMappings: () => <div>Mappings</div>,
    onUpdate: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <AgentWorkflowEditorDrawer {...props} />
    </ChakraProvider>,
  );
  return { ...view, props };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("workflow agent editor", () => {
  it("saves a trimmed name with the existing workflow config and mappings", async () => {
    const { props } = editor();
    await waitFor(() => expect(screen.getByTestId("agent-name-input")).toHaveValue(agent.name));
    fireEvent.change(screen.getByTestId("agent-name-input"), { target: { value: "  Renamed  " } });
    fireEvent.click(screen.getByTestId("save-agent-button"));

    expect(props.onUpdate).toHaveBeenCalledWith({
      id: agent.id,
      name: "Renamed",
      config: {
        ...agent.config,
        name: "Renamed",
        scenarioOutputField: void 0,
      },
    });
  });

  it("keeps the drawer open when discarding edits is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { props } = editor();
    await waitFor(() => expect(screen.getByTestId("agent-name-input")).toHaveValue(agent.name));
    fireEvent.change(screen.getByTestId("agent-name-input"), { target: { value: "Unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("does not save while the workflow is loading or has no published inputs", () => {
    const { props } = editor({ isLoading: true, workflowInputs: [] });
    fireEvent.click(screen.getByTestId("save-agent-button"));
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId("save-agent-button")).toBeDisabled();
  });
});

describe("workflow target editor", () => {
  it("hides mappings after a lookup failure and leaves the drawer closable", () => {
    const onClose = vi.fn();
    render(
      <ChakraProvider value={defaultSystem}>
        <AgentWorkflowTargetEditorDrawer
          open={true}
          isLoading={false}
          hasLookupFailed={true}
          mappings={<div>Unsafe mappings</div>}
          onClose={onClose}
        />
      </ChakraProvider>,
    );

    expect(screen.getByTestId("workflow-lookup-error")).toBeVisible();
    expect(screen.queryByText("Unsafe mappings")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("close-drawer-button"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
