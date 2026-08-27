import type { Node } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { HttpConfigEditor, useHttpTest } from "~/components/agents/http";
import { CodeBlockEditor } from "~/components/blocks/CodeBlockEditor";
import { OutputsSection } from "~/components/outputs/OutputsSection";
import { VariablesSection } from "~/components/variables";
import { useDrawer } from "~/hooks/useDrawer";
import type {
  AgentComponent,
  Component,
  ComponentType,
  End,
  Entry,
  Evaluator,
  PromptingTechnique,
  Retriever,
} from "@langwatch/workflow-contract";
import {
  CodePropertiesPanel as WorkflowCodePropertiesPanel,
  EndPropertiesPanel as WorkflowEndPropertiesPanel,
  EntryPointPropertiesPanel as WorkflowEntryPointPropertiesPanel,
  HttpPropertiesPanel as WorkflowHttpPropertiesPanel,
  IfElsePropertiesPanel as WorkflowIfElsePropertiesPanel,
  InsideDrawerProvider,
  LiquidConditionEditor,
  PromptingTechniquePropertiesPanel as WorkflowPromptingTechniquePropertiesPanel,
  RetrievePropertiesPanel as WorkflowRetrievePropertiesPanel,
  type WorkflowBasePropertiesPanelProps,
  type WorkflowCodeEditorProps,
  type WorkflowHttpConfigProps,
  type WorkflowHttpTestConfig,
  type WorkflowOutputsProps,
  type WorkflowVariablesProps,
  useWorkflowStore,
} from "@langwatch/workflow-web";
import { DatasetModal } from "../DatasetModal";
import { AgentPropertiesPanel } from "../properties/AgentPropertiesPanel";
import { BasePropertiesPanel, PropertySectionTitle } from "../properties/BasePropertiesPanel";
import { CustomPropertiesPanel } from "../properties/CustomPropertiesPanel";
import { EvaluatorPropertiesPanel } from "../properties/EvaluatorPropertiesPanel";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { SignaturePromptEditorBridge } from "./SignaturePromptEditorBridge";
import { StudioDrawerWrapper } from "./StudioDrawerWrapper";

function CodePropertiesPanel({ node }: { node: Node<Component> }) {
  return (
    <WorkflowCodePropertiesPanel
      node={node}
      renderBase={(props: WorkflowBasePropertiesPanelProps) => <BasePropertiesPanel {...props} />}
      renderCodeEditor={(props: WorkflowCodeEditorProps) => <CodeBlockEditor {...props} />}
      renderVariables={(props: WorkflowVariablesProps) => <VariablesSection {...props} />}
      renderOutputs={(props: WorkflowOutputsProps) => <OutputsSection {...props} />}
    />
  );
}

function EndPropertiesPanel({ node }: { node: Node<End> }) {
  return (
    <WorkflowEndPropertiesPanel
      node={node}
      renderBase={(props: WorkflowBasePropertiesPanelProps) => <BasePropertiesPanel {...props} />}
      renderVariables={(props: WorkflowVariablesProps) => <VariablesSection {...props} />}
    />
  );
}

function EntryPointPropertiesPanel({ node }: { node: Node<Entry> }) {
  const { total } = useGetDatasetData({ dataset: node.data.dataset, preview: true });

  return (
    <WorkflowEntryPointPropertiesPanel
      node={node}
      datasetTotal={total}
      renderBase={(props: WorkflowBasePropertiesPanelProps) => <BasePropertiesPanel {...props} />}
      renderVariables={(props: WorkflowVariablesProps) => <VariablesSection {...props} />}
      renderDatasetModal={DatasetModal}
      renderPropertySectionTitle={PropertySectionTitle}
    />
  );
}

function HttpPropertiesPanel({ node }: { node: Node<Component> }) {
  return (
    <WorkflowHttpPropertiesPanel
      node={node}
      useHttpTest={(config: WorkflowHttpTestConfig) => useHttpTest(config)}
      renderBase={(props: WorkflowBasePropertiesPanelProps) => <BasePropertiesPanel {...props} />}
      renderHttpConfig={(props: WorkflowHttpConfigProps) => <HttpConfigEditor {...props} />}
      renderVariables={(props: WorkflowVariablesProps) => <VariablesSection {...props} />}
      renderOutputs={(props: WorkflowOutputsProps) => <OutputsSection {...props} />}
    />
  );
}

function IfElsePropertiesPanel({ node }: { node: Node<Component> }) {
  return (
    <WorkflowIfElsePropertiesPanel
      node={node}
      renderBase={(props: WorkflowBasePropertiesPanelProps) => <BasePropertiesPanel {...props} />}
      renderCodeEditor={(props: WorkflowCodeEditorProps) => <CodeBlockEditor {...props} />}
      renderVariables={(props: WorkflowVariablesProps) => <VariablesSection {...props} />}
      renderPropertySectionTitle={PropertySectionTitle}
      renderLiquidConditionEditor={LiquidConditionEditor}
    />
  );
}

function PromptingTechniquePropertiesPanel({ node }: { node: Node<PromptingTechnique> }) {
  return (
    <WorkflowPromptingTechniquePropertiesPanel
      node={node}
      renderBase={(props: WorkflowBasePropertiesPanelProps) => <BasePropertiesPanel {...props} />}
    />
  );
}

function RetrievePropertiesPanel({ node }: { node: Node<Retriever> }) {
  return (
    <WorkflowRetrievePropertiesPanel
      node={node}
      renderBase={(props: WorkflowBasePropertiesPanelProps) => <BasePropertiesPanel {...props} />}
    />
  );
}

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
  if_else: IfElsePropertiesPanel,
};

/**
 * StudioNodeDrawer subscribes to the workflow store's selected node and
 * renders the appropriate properties panel inside a StudioDrawerWrapper.
 *
 * All node types (including signature/LLM) go through StudioDrawerWrapper
 * for unified play/expand/close controls.
 */
export function StudioNodeDrawer() {
  const { selectedNode, deselectAllNodes, isDraggingNode, clickedNodeId } = useWorkflowStore(
    useShallow((state) => ({
      selectedNode: state.nodes.find((n) => n.selected),
      deselectAllNodes: state.deselectAllNodes,
      isDraggingNode: state.isDraggingNode,
      clickedNodeId: state.clickedNodeId,
    })),
  );

  const { currentDrawer } = useDrawer();

  // Don't open the drawer for evaluator/agent nodes without an entity set
  // (they're still in the picker flow)
  const isEmptyEvaluator =
    selectedNode?.type === "evaluator" && !(selectedNode.data as Evaluator).evaluator;
  const isEmptyAgent =
    selectedNode?.type === "agent" && !(selectedNode.data as AgentComponent).agent;

  // Suppress the StudioDrawerWrapper when a URL-based drawer (e.g.
  // PromptListDrawer, EvaluatorListDrawer) is active. This prevents
  // two drawers from rendering simultaneously. The URL drawer takes
  // priority; once it closes, the StudioDrawerWrapper will naturally
  // appear for the selected node.
  const hasUrlDrawer = !!currentDrawer;

  // Only open the drawer when onNodeClick has confirmed a genuine click
  // (mousedown + mouseup without drag). This prevents the drawer from
  // opening when the user merely drags a node (which selects it on mousedown).
  const hasClickConfirmation = selectedNode && clickedNodeId === selectedNode.id;

  const effectiveNode =
    !hasUrlDrawer && !isEmptyEvaluator && !isEmptyAgent && !isDraggingNode && hasClickConfirmation
      ? selectedNode
      : undefined;

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
