import { useCallback, useRef } from "react";

import type { AgentWithFields } from "@langwatch/agent-contract";
import type { Component, NodeWithOptionalPosition } from "@langwatch/workflow-contract";

import { useWorkflowStore } from "./use-workflow-store";
import { buildAgentNodeData } from "../model/agent-node-data";

export type AgentPickerCallbacks = {
  onSelect: (agent: AgentWithFields) => void;
  onCreateNew: () => void;
  onClose: () => void;
};

export type AgentPickerPort = {
  register: (callbacks: AgentPickerCallbacks) => void;
  registerCreation: (onSave: (agent: AgentWithFields) => void) => void;
  openList: () => void;
  openTypeSelector: () => void;
  close: () => void;
};

/** Workflow-owned state transition for selecting an agent after a canvas drop. */
export function useWorkflowAgentPickerFlow(port: AgentPickerPort) {
  const { setNode, deleteNode, setSelectedNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
    deleteNode: state.deleteNode,
    setSelectedNode: state.setSelectedNode,
  }));
  const pendingAgentRef = useRef<string | null>(null);

  const handleAgentDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      const nodeId = item.node.id;

      pendingAgentRef.current = nodeId;
      const applyAgent = (agent: AgentWithFields) => {
        if (!pendingAgentRef.current) {
          return;
        }
        const selectedNodeId = pendingAgentRef.current;
        setNode({
          id: selectedNodeId,
          data: buildAgentNodeData(agent),
        });
        pendingAgentRef.current = null;
        port.close();
        setSelectedNode(selectedNodeId);
      };

      port.register({
        onSelect: applyAgent,
        onCreateNew: () => {
          port.registerCreation(applyAgent);
          port.openTypeSelector();
        },
        onClose: () => {
          if (pendingAgentRef.current) {
            deleteNode(pendingAgentRef.current);
            pendingAgentRef.current = null;
          }
          port.close();
        },
      });
      port.openList();
    },
    [deleteNode, port, setNode, setSelectedNode],
  );

  return { handleAgentDragEnd, pendingAgentRef };
}
