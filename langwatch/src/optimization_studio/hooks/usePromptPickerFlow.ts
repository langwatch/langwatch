import { useCallback, useRef } from "react";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import type { Component, Field } from "../types/dsl";
import type { NodeWithOptionalPosition } from "~/types";
import { useWorkflowStore } from "./useWorkflowStore";

type PromptSelection = {
  id: string;
  name: string;
  version?: number;
  versionId?: string;
  inputs?: Array<{ identifier: string; type: string }>;
  outputs?: Array<{ identifier: string; type: string }>;
};

/**
 * Hook that provides a drag-end handler for the LLM Signature node draggable.
 *
 * When a prompt node is dropped on the canvas, this opens the PromptListDrawer
 * so the user can pick an existing prompt or create a new one. The flow:
 *
 * - onSelect: updates the placeholder node with prompt metadata
 * - onCreateNew: keeps the placeholder as a blank new prompt
 * - onClose (cancel): removes the placeholder node from the canvas
 */
export function usePromptPickerFlow() {
  const { openDrawer, closeDrawer } = useDrawer();
  const { setNode, deleteNode, setSelectedNode } = useWorkflowStore(
    (state) => ({
      setNode: state.setNode,
      deleteNode: state.deleteNode,
      setSelectedNode: state.setSelectedNode,
    }),
  );

  const pendingPromptRef = useRef<string | null>(null);

  const handlePromptDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      const nodeId = item.node.id;
      pendingPromptRef.current = nodeId;

      setFlowCallbacks("promptList", {
        onSelect: (prompt: PromptSelection) => {
          if (pendingPromptRef.current) {
            const nodeId = pendingPromptRef.current;
            setNode({
              id: nodeId,
              data: {
                name: prompt.name,
                configId: prompt.id,
                versionMetadata: prompt.versionId
                  ? {
                      versionId: prompt.versionId,
                      versionNumber: prompt.version ?? 0,
                      versionCreatedAt: new Date().toISOString(),
                    }
                  : undefined,
                inputs: (prompt.inputs ?? []).map((i) => ({
                  identifier: i.identifier,
                  type: i.type as Field["type"],
                })),
                outputs: (prompt.outputs ?? []).map((o) => ({
                  identifier: o.identifier,
                  type: o.type as Field["type"],
                })),
              } as Partial<Component>,
            });
            pendingPromptRef.current = null;
            closeDrawer();
            setSelectedNode(nodeId);
          } else {
            closeDrawer();
          }
        },
        onCreateNew: () => {
          const nodeId = pendingPromptRef.current;
          pendingPromptRef.current = null;
          // Close the picker drawer first, then select the node.
          // StudioNodeDrawer suppresses itself while the URL drawer is
          // active, so it will naturally open once closeDrawer finishes.
          closeDrawer();
          if (nodeId) {
            setSelectedNode(nodeId);
          }
        },
        onClose: () => {
          // Cancel: remove the placeholder node
          if (pendingPromptRef.current) {
            deleteNode(pendingPromptRef.current);
            pendingPromptRef.current = null;
          }
          closeDrawer();
        },
      });

      // Defer drawer opening to next tick so ReactFlow's D3 drag system
      // finishes processing the drop before we trigger a URL change (re-render).
      // Without this, the nodeLookup can become stale mid-drag-end.
      setTimeout(() => {
        openDrawer("promptList", undefined, { resetStack: true });
      }, 0);
    },
    [openDrawer, closeDrawer, setNode, deleteNode, setSelectedNode],
  );

  return { handlePromptDragEnd, pendingPromptRef };
}
