import type { Node } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { AgentComponent, Component, ComponentType, Evaluator } from "../../types/dsl";
import { AgentPropertiesPanel } from "../properties/AgentPropertiesPanel";
import { CodePropertiesPanel } from "../properties/CodePropertiesPanel";
import { CustomPropertiesPanel } from "../properties/CustomPropertiesPanel";
import { EndPropertiesPanel } from "../properties/EndPropertiesPanel";
import { EntryPointPropertiesPanel } from "../properties/EntryPointPropertiesPanel";
import { EvaluatorPropertiesPanel } from "../properties/EvaluatorPropertiesPanel";
import { HttpPropertiesPanel } from "../properties/HttpPropertiesPanel";
import { PromptingTechniquePropertiesPanel } from "../properties/PromptingTechniquePropertiesPanel";
import { RetrievePropertiesPanel } from "../properties/RetrievePropertiesPanel";
import { SignaturePromptEditorBridge } from "./SignaturePromptEditorBridge";
import { StudioDrawerWrapper } from "./StudioDrawerWrapper";
import { InsideDrawerProvider } from "./useInsideDrawer";
import { useDrawer } from "~/hooks/useDrawer";

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
  http: HttpPropertiesPanel,
  agent: AgentPropertiesPanel as React.FC<{ node: Node<Component> }>,
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
 */
export function StudioNodeDrawer() {
  const { selectedNode, deselectAllNodes } = useWorkflowStore(
    useShallow((state) => ({
      selectedNode: state.nodes.find((n) => n.selected),
      deselectAllNodes: state.deselectAllNodes,
    })),
  );

  const { currentDrawer } = useDrawer();

  // Don't open the drawer for evaluator/agent nodes without an entity set
  // (they're still in the picker flow)
  const isEmptyEvaluator =
    selectedNode?.type === "evaluator" &&
    !(selectedNode.data as Evaluator).evaluator;
  const isEmptyAgent =
    selectedNode?.type === "agent" &&
    !(selectedNode.data as AgentComponent).agent;

  // Suppress the StudioDrawerWrapper when a URL-based drawer (e.g.
  // PromptListDrawer, EvaluatorListDrawer) is active. This prevents
  // two drawers from rendering simultaneously. The URL drawer takes
  // priority; once it closes, the StudioDrawerWrapper will naturally
  // appear for the selected node.
  const hasUrlDrawer = !!currentDrawer;

  const effectiveNode =
    !hasUrlDrawer && !isEmptyEvaluator && !isEmptyAgent ? selectedNode : undefined;

  const PanelComponent = effectiveNode
    ? ComponentPropertiesPanelMap[effectiveNode.type as ComponentType]
    : undefined;

  return (
    <InsideDrawerProvider>
      <StudioDrawerWrapper node={effectiveNode} onClose={deselectAllNodes}>
        {effectiveNode && PanelComponent && (
          <PanelComponent key={effectiveNode.id} node={effectiveNode} />
        )}
      </StudioDrawerWrapper>
    </InsideDrawerProvider>
  );
}
