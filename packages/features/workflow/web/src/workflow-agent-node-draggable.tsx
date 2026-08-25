import { MODULES } from "./studio-registry";
import type { Component } from "@langwatch/workflow-contract";
import type { NodeWithOptionalPosition } from "@langwatch/workflow-contract";
import { NodeDraggable } from "./workflow-node-draggable";

type AgentNodeDraggableProps = {
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
};

/**
 * Single "Agent" draggable in the sidebar.
 *
 * Uses MODULES.agent as the node template. On drag-end the caller
 * (via useAgentPickerFlow) opens the agent list drawer so the user
 * can choose an existing agent or create a new one.
 */
export function AgentNodeDraggable({ onDragEnd }: AgentNodeDraggableProps) {
  return (
    <NodeDraggable
      component={{
        ...MODULES.agent,
        name: "Agent",
        description:
          "Drag and drop to add an agent node. Pick an existing agent or create a new one.",
      }}
      type="agent"
      onDragEnd={onDragEnd}
    />
  );
}
