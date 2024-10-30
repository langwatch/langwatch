import type { Node } from "@xyflow/react";
import { BasePropertiesPanel } from "./BasePropertiesPanel";
import type { Retriever } from "../../types/dsl";

export function RetrievePropertiesPanel({ node }: { node: Node<Retriever> }) {
  return <BasePropertiesPanel node={node} hideInputs hideOutputs />;
}
