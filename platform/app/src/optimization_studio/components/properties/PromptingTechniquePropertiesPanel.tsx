import type { Node } from "@xyflow/react";
import type { PromptingTechnique } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

export function PromptingTechniquePropertiesPanel({
  node,
}: {
  node: Node<PromptingTechnique>;
}) {
  return <BasePropertiesPanel node={node} hideInputs hideOutputs />;
}
