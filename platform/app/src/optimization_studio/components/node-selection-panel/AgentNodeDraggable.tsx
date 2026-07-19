import type { Component } from "~/optimization_studio/types/dsl";
import type { NodeWithOptionalPosition } from "~/types";
import { MODULES } from "~/optimization_studio/registry";
import { NodeDraggable } from "./NodeDraggable";

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
