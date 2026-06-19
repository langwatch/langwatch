import { useCallback, useRef } from "react";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { NodeWithOptionalPosition } from "~/types";
import type { Component } from "../types/dsl";
import { buildAgentNodeData } from "../utils/agentNodeData";
import { useWorkflowStore } from "./useWorkflowStore";

/**
 * Hook that provides a drag-end handler for the Agent node draggable.
 *
 * When an agent node is dropped on the canvas, this opens the
 * AgentListDrawer so the user can pick an existing agent or create
 * a new one. The flow mirrors useEvaluatorPickerFlow:
 *
 * - onSelect: updates the placeholder node with agent data, selects it
 * - onCreateNew: opens the agent type selector to create a new one
 * - onClose (cancel): removes the placeholder node from the canvas
 */
export function useAgentPickerFlow() {
  const { openDrawer, closeDrawer } = useDrawer();
  const { setNode, deleteNode, setSelectedNode } = useWorkflowStore(
    (state) => ({
      setNode: state.setNode,
      deleteNode: state.deleteNode,
      setSelectedNode: state.setSelectedNode,
    }),
  );

  const pendingAgentRef = useRef<string | null>(null);

  const handleAgentDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      const nodeId = item.node.id;
      pendingAgentRef.current = nodeId;

      setFlowCallbacks("agentList", {
        onSelect: (agent: TypedAgent) => {
          if (pendingAgentRef.current) {
            setNode({
              id: pendingAgentRef.current,
              data: buildAgentNodeData(agent) as Partial<Component>,
            });
            const nodeToSelect = pendingAgentRef.current;
            pendingAgentRef.current = null;
            closeDrawer();
            setSelectedNode(nodeToSelect);
          }
        },
        onCreateNew: () => {
          // Wire up so newly created agent is applied to the pending node
          const onAgentSaved = (agent: TypedAgent) => {
            if (pendingAgentRef.current) {
              setNode({
                id: pendingAgentRef.current,
                data: buildAgentNodeData(agent) as Partial<Component>,
              });
              const nodeId = pendingAgentRef.current;
              pendingAgentRef.current = null;
              closeDrawer();
              setSelectedNode(nodeId);
            }
          };
          setFlowCallbacks("agentHttpEditor", { onSave: onAgentSaved });
          setFlowCallbacks("agentCodeEditor", { onSave: onAgentSaved });
          setFlowCallbacks("workflowSelector", { onSave: onAgentSaved });
          openDrawer("agentTypeSelector");
        },
        onClose: () => {
          // Cancel: remove the placeholder node
          if (pendingAgentRef.current) {
            deleteNode(pendingAgentRef.current);
            pendingAgentRef.current = null;
          }
          closeDrawer();
        },
      });

      // Defer drawer opening to next tick so ReactFlow's D3 drag system
      // finishes processing the drop before we trigger a URL change (re-render).
      setTimeout(() => {
        openDrawer("agentList", undefined, { resetStack: true });
      }, 0);
    },
    [openDrawer, closeDrawer, setNode, deleteNode, setSelectedNode],
  );

  return { handleAgentDragEnd, pendingAgentRef };
}
