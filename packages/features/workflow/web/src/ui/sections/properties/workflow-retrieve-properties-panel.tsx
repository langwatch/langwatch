import type { Node } from "@xyflow/react";
import type { Retriever } from "@langwatch/workflow-contract";
import type { WorkflowBasePropertiesPanelProps } from "./workflow-properties.ports";

export function RetrievePropertiesPanel({
  node,
  renderBase: BasePropertiesPanel,
}: {
  node: Node<Retriever>;
  renderBase: (props: WorkflowBasePropertiesPanelProps) => React.ReactNode;
}) {
  return <BasePropertiesPanel node={node} hideInputs hideOutputs />;
}
