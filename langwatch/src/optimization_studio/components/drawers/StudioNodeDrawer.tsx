import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, ComponentType, Evaluator } from "../../types/dsl";
import { CodePropertiesPanel } from "../properties/CodePropertiesPanel";
import { CustomPropertiesPanel } from "../properties/CustomPropertiesPanel";
import { EndPropertiesPanel } from "../properties/EndPropertiesPanel";
import { EntryPointPropertiesPanel } from "../properties/EntryPointPropertiesPanel";
import { EvaluatorPropertiesPanel } from "../properties/EvaluatorPropertiesPanel";
import { PromptingTechniquePropertiesPanel } from "../properties/PromptingTechniquePropertiesPanel";
import { RetrievePropertiesPanel } from "../properties/RetrievePropertiesPanel";
import { WorkflowPropertiesPanel } from "../properties/WorkflowPropertiesPanel";
import { SignaturePromptEditorBridge } from "./SignaturePromptEditorBridge";
import { StudioDrawerWrapper } from "./StudioDrawerWrapper";
import { InsideDrawerProvider } from "./useInsideDrawer";

/**
 * Panel map for all node types. Every node type goes through
 * StudioDrawerWrapper for unified play/expand/close controls.
 */
const ComponentPropertiesPanelMap: Partial<
  Record<ComponentType, React.FC<{ node: Node<Component> }>>
> = {
  entry: EntryPointPropertiesPanel as React.FC<{ node: Node<Component> }>,
  end: EndPropertiesPanel as React.FC<{ node: Node<Component> }>,
  signature: SignaturePromptEditorBridge as React.FC<{ node: Node<Component> }>,
  code: CodePropertiesPanel,
  custom: CustomPropertiesPanel,
  retriever: RetrievePropertiesPanel,
  prompting_technique: PromptingTechniquePropertiesPanel,
  evaluator: EvaluatorPropertiesPanel as React.FC<{ node: Node<Component> }>,
};

/**
 * StudioNodeDrawer subscribes to the workflow store's selected node and
 * renders the appropriate properties panel inside a StudioDrawerWrapper.
 *
 * All node types (including signature/LLM) go through StudioDrawerWrapper
 * for unified play/expand/close controls.
 *
 * When no node is selected but the workflow background was clicked, it falls
 * back to rendering the WorkflowPropertiesPanel in a plain sidebar.
 */
export function StudioNodeDrawer() {
  const { selectedNode, workflowSelected, deselectAllNodes } =
    useWorkflowStore(
      useShallow((state) => ({
        selectedNode: state.nodes.find((n) => n.selected),
        workflowSelected: state.workflowSelected,
        deselectAllNodes: state.deselectAllNodes,
      })),
    );

  // Don't open the drawer for evaluator nodes without an evaluator set
  // (they're still in the "Choose Evaluator" flow)
  const isEmptyEvaluator =
    selectedNode?.type === "evaluator" &&
    !(selectedNode.data as Evaluator).evaluator;

  const PanelComponent =
    selectedNode && !isEmptyEvaluator
      ? ComponentPropertiesPanelMap[selectedNode.type as ComponentType]
      : undefined;

  return (
    <>
      {/* Workflow-level settings panel (no node selected, background clicked) */}
      {!selectedNode && workflowSelected && (
        <Box
          position="relative"
          top={0}
          right={0}
          background="white"
          border="1px solid"
          borderColor="border.emphasized"
          borderTopWidth={0}
          borderBottomWidth={0}
          borderRightWidth={0}
          zIndex={100}
          height="full"
        >
          <WorkflowPropertiesPanel />
        </Box>
      )}

      {/* All node types go through StudioDrawerWrapper */}
      <InsideDrawerProvider>
        <StudioDrawerWrapper
          node={isEmptyEvaluator ? undefined : selectedNode}
          onClose={deselectAllNodes}
        >
          {selectedNode && PanelComponent && (
            <PanelComponent key={selectedNode.id} node={selectedNode} />
          )}
        </StudioDrawerWrapper>
      </InsideDrawerProvider>
    </>
  );
}
