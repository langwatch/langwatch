/**
 * @vitest-environment jsdom
 *
 * The studio shell mounts the node host once, so the node panel, the drag
 * preview and the drawers all read it instead of throwing.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const storeState: Record<string, unknown> = {
  name: "Studio test",
  workflow_id: "workflow-1",
  nodes: [],
  edges: [],
  state: {},
  propertiesExpanded: false,
  hoveredNodeId: undefined,
  branchConnectionInProgress: false,
  branchConnectionSourceId: undefined,
  getWorkflow: () => ({ nodes: [], edges: [] }),
};

const canvasProps = vi.hoisted(() => ({
  seen: [] as { nodeTypes?: unknown; edgeTypes?: unknown }[],
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof ReactFlowModule>();
  const Original = original.ReactFlow;

  return {
    ...original,
    ReactFlow: (props: React.ComponentProps<typeof Original>) => {
      canvasProps.seen.push({ nodeTypes: props.nodeTypes, edgeTypes: props.edgeTypes });
      return <Original {...props} />;
    },
  };
});

vi.mock("../../../../behavior/use-workflow-store.ts", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector(
      new Proxy(storeState, {
        get: (target, key) => (key in target ? target[String(key)] : vi.fn()),
      }),
    ),
}));
vi.mock("../../../../behavior/lent-model-provider.tsx", () => ({ LLMModelDisplay: () => null }));
vi.mock("../../../../behavior/use-workflow-agent-picker-flow.ts", () => ({
  useWorkflowAgentPickerFlow: () => ({ handleAgentDragEnd: vi.fn() }),
}));
vi.mock("../../../../behavior/use-workflow-evaluator-picker-flow.ts", () => ({
  useWorkflowEvaluatorPickerFlow: () => ({ handleEvaluatorDragEnd: vi.fn() }),
}));
vi.mock("../../../../behavior/use-workflow-prompt-picker-flow.ts", () => ({
  useWorkflowPromptPickerFlow: () => ({ handlePromptDragEnd: vi.fn() }),
}));
vi.mock("../../../../behavior/optimization_studio/use-component-version.tsx", () => ({
  useComponentVersion: () => ({ currentVersion: null }),
}));
vi.mock("../../../../behavior/optimization_studio/use-get-dataset-data.ts", () => ({
  useGetDatasetData: () => ({ total: 0, rows: [], columns: [] }),
}));
vi.mock("../../../../behavior/optimization_studio/use-load-workflow.ts", () => ({
  useLoadWorkflow: () => ({ workflow: { data: undefined, isFetched: false } }),
}));
vi.mock("../../../../behavior/studio-host/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "project" } }),
}));
vi.mock("../../../../behavior/use-ask-before-leaving.ts", () => ({
  useAskBeforeLeaving: () => undefined,
}));
vi.mock("../../../elements/compat/next-head.tsx", () => ({ default: () => null }));
vi.mock("../../workflow-autosave.tsx", () => ({ WorkflowAutosave: () => null }));
vi.mock("../../workflow-name-popover.tsx", () => ({ WorkflowNamePopover: () => null }));
vi.mock("../../workflow-progress-toast.tsx", () => ({ WorkflowProgressToast: () => null }));
vi.mock("../../workflow-run-until-here-dialog.tsx", () => ({
  WorkflowRunUntilHereDialog: () => null,
  getWorkflowEntryNode: () => undefined,
}));
vi.mock("../../workflow-running-status.tsx", () => ({ WorkflowRunningStatus: () => null }));
vi.mock("../../workflow-undo-redo.tsx", () => ({ WorkflowUndoRedo: () => null }));
vi.mock("../evaluate.tsx", () => ({ Evaluate: () => null }));
vi.mock("../history.tsx", () => ({ History: () => null }));
vi.mock("../optimize.tsx", () => ({ Optimize: () => null }));
vi.mock("../publish.tsx", () => ({ Publish: () => null }));
vi.mock("../results-panel.tsx", () => ({ ResultsPanel: () => null }));
vi.mock("../use-component-execution.ts", () => ({
  useComponentExecution: () => ({
    startComponentExecution: vi.fn(),
    stopComponentExecution: vi.fn(),
  }),
}));
vi.mock("../use-evaluation-execution.ts", () => ({
  useEvaluationExecution: () => ({ stopEvaluationExecution: vi.fn() }),
}));
vi.mock("../use-optimization-execution.ts", () => ({
  useOptimizationExecution: () => ({ stopOptimizationExecution: vi.fn() }),
}));
vi.mock("../use-workflow-execution.ts", () => ({
  useWorkflowExecution: () => ({
    startWorkflowExecution: vi.fn(),
    stopWorkflowExecution: vi.fn(),
  }),
}));
vi.mock("../use-post-event.tsx", () => ({
  PostEventProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePostEvent: () => ({ socketStatus: "connected" }),
}));
vi.mock("../drawers/studio-node-drawer.tsx", () => ({
  StudioNodeDrawer: () => (
    <ComponentExecutionButton node={{ ...dragItemNode, position: { x: 0, y: 0 } }} />
  ),
}));
vi.mock("@langwatch/browser-host/link", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@langwatch/browser-host/toaster", () => ({ toaster: { create: vi.fn() } }));
vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), currentDrawer: undefined }),
}));
vi.mock("../../../../behavior/workflow-api.ts", () => ({
  workflowApi: {
    useUtils: () => ({ workflow: { getVersions: { refetch: vi.fn() } } }),
    workflow: { autosave: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
    modelProvider: { getResolvedDefault: { useQuery: () => ({ data: undefined }) } },
    optimization: { getComponents: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("../../../blocks/dataset/dataset-image-preview-table.tsx", () => ({
  DatasetImagePreviewTable: () => null,
}));
vi.mock("../../../elements/experiment/BatchEvaluationV2/evaluation-progress-bar.tsx", () => ({
  EvaluationProgressBar: () => null,
}));
vi.mock("@langwatch/design-system/color-mode", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useColorMode: () => ({ colorMode: "light" }),
  useColorModeValue: (light: string) => light,
  useColorRawValue: (value: string) => value,
}));
vi.mock("../../../elements/workflow-icons.tsx", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ComponentIcon: () => null,
}));
vi.mock("../../../../behavior/crisp-bubble-policy.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertCrispChatHidden: () => undefined,
}));
vi.mock("react-dnd", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDragLayer: () => ({
    isDragging: true,
    item: { node: dragItemNode },
    itemType: "node",
    currentOffset: { x: 0, y: 0 },
  }),
}));

import type { Component } from "@langwatch/workflow-contract";
import type * as ReactFlowModule from "@xyflow/react";
import type { Node } from "@xyflow/react";
import type React from "react";

import { MODULES } from "../../../../model/studio-registry.ts";
import { WorkflowEdge } from "../../workflow-edge.tsx";
import { ComponentExecutionButton } from "../../workflow-node-execution.tsx";
import { workflowNodeComponents } from "../../workflow-nodes.registry.ts";
import OptimizationStudio from "../optimization-studio.tsx";

const dragItemNode: Node<Component> & { type: "signature" } = {
  id: "signature-1",
  type: "signature",
  position: { x: 0, y: 0 },
  data: { ...MODULES.signature, name: "Signature 1" },
};

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(cleanup);

describe("given the workflow studio shell", () => {
  describe("when it loads with the node panel, a node being dragged and a drawer button", () => {
    /** @scenario "Canvas node renderers use explicit application host ports" */
    it("renders every node consumer inside the one node host without throwing", () => {
      renderWithDesignSystem(<OptimizationStudio />);

      expect(screen.getAllByText("Components").length).toBeGreaterThan(0);
      expect(screen.getByTestId("workflow-node-signature")).toBeTruthy();
      expect(screen.getByTestId("workflow-node-execution-status")).toBeTruthy();
    });
  });
});

describe("given the Workflow browser surface mounts the canvas", () => {
  describe("when it resolves node and default-edge renderers", () => {
    /** @scenario "The canvas resolves its renderers from the Workflow browser surface" */
    it("takes node renderers from the node registry and wraps the one default edge inline", () => {
      canvasProps.seen.length = 0;
      renderWithDesignSystem(<OptimizationStudio />);

      const canvas = canvasProps.seen.at(-1);

      expect(canvas?.nodeTypes).toBe(workflowNodeComponents);
      expect(canvas?.edgeTypes).toEqual({ default: WorkflowEdge });
      expect(Object.keys(canvas?.edgeTypes as object)).toEqual(["default"]);
    });
  });
});
