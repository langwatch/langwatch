import type { Component, NodeWithOptionalPosition } from "@langwatch/workflow-contract";

import { MODULES } from "../../model/studio-registry.ts";
import { NodeDraggable } from "./workflow-node-draggable.tsx";

type AgentNodeDraggableProps = {
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
};

/**
 * Single "Agent" draggable in the sidebar. Uses MODULES.agent as the
 * template. On drag-end, useAgentPickerFlow opens the drawer to pick or
 * create one.
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
