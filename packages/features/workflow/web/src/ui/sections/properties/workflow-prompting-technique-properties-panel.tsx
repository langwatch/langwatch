import type { Node } from "@xyflow/react";
import type { PromptingTechnique } from "@langwatch/workflow-contract";
import type { WorkflowBasePropertiesPanelProps } from "./workflow-properties.ports";

export function PromptingTechniquePropertiesPanel({
  node,
  renderBase: BasePropertiesPanel,
}: {
  node: Node<PromptingTechnique>;
  renderBase: (props: WorkflowBasePropertiesPanelProps) => React.ReactNode;
}) {
  return <BasePropertiesPanel node={node} hideInputs hideOutputs />;
}
