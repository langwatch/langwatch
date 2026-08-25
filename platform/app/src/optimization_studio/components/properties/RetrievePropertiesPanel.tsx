import type { Node } from "@xyflow/react";
import type { Retriever } from "@langwatch/workflow-contract";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

export function RetrievePropertiesPanel({ node }: { node: Node<Retriever> }) {
  return <BasePropertiesPanel node={node} hideInputs hideOutputs />;
}
