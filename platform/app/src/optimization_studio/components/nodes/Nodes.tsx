/** App compatibility adapter for Workflow canvas-node rendering. */
export {
  ComponentExecutionButton,
  ComponentNode,
  isExecutableComponent,
  NodeSectionTitle,
  selectionColor,
  TypeLabel,
} from "@langwatch/workflow-web";

export function getNodeDisplayName(node: {
  id: string;
  data: { localConfig?: { name?: string }; name?: string; cls?: string };
}) {
  return node.data.localConfig?.name ?? node.data.name ?? node.data.cls ?? node.id;
}
