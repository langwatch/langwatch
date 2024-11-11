import type { Node } from "@xyflow/react";
import type { End } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

export function EndPropertiesPanel({ node }: { node: Node<End> }) {
  return (
    <BasePropertiesPanel
      node={node}
      hideOutputs
      hideParameters
      inputsTitle="Results"
    />
  );
}
