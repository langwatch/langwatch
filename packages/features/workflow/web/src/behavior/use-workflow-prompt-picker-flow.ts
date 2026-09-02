import { useCallback, useRef } from "react";

import type { Component, NodeWithOptionalPosition } from "@langwatch/workflow-contract";
import { fieldSchema } from "@langwatch/workflow-contract";

import { useWorkflowStore } from "./use-workflow-store";

export type PromptSelection = {
  id: string;
  name: string;
  version?: number;
  versionId?: string;
  inputs?: Array<{ identifier: string; type: string }>;
  outputs?: Array<{ identifier: string; type: string }>;
};

export type PromptPickerCallbacks = {
  onSelect: (prompt: PromptSelection) => void;
  onCreateNew: () => void;
  onClose: () => void;
};

export type PromptPickerPort = {
  register: (callbacks: PromptPickerCallbacks) => void;
  open: () => void;
  close: () => void;
};

/** Workflow-owned state transition for selecting a prompt after a canvas drop. */
export function useWorkflowPromptPickerFlow(port: PromptPickerPort) {
  const { setNode, deleteNode, setSelectedNode } = useWorkflowStore((state) => ({
    setNode: state.setNode,
    deleteNode: state.deleteNode,
    setSelectedNode: state.setSelectedNode,
  }));
  const pendingPromptRef = useRef<string | null>(null);

  const handlePromptDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      const nodeId = item.node.id;

      pendingPromptRef.current = nodeId;
      port.register({
        onSelect: (prompt) => {
          if (!pendingPromptRef.current) {
            port.close();
            return;
          }

          const selectedNodeId = pendingPromptRef.current;
          setNode({
            id: selectedNodeId,
            data: {
              name: prompt.name,
              promptId: prompt.id,
              promptVersionId: prompt.versionId,
              configId: prompt.id,
              versionMetadata: prompt.versionId
                ? {
                    versionId: prompt.versionId,
                    versionNumber: prompt.version ?? 0,
                    versionCreatedAt: new Date().toISOString(),
                  }
                : void 0,
              inputs: (prompt.inputs ?? []).map((input) =>
                fieldSchema.parse({ identifier: input.identifier, type: input.type }),
              ),
              outputs: (prompt.outputs ?? []).map((output) =>
                fieldSchema.parse({ identifier: output.identifier, type: output.type }),
              ),
            },
          });
          pendingPromptRef.current = null;
          port.close();
          setSelectedNode(selectedNodeId);
        },
        onCreateNew: () => {
          const selectedNodeId = pendingPromptRef.current;
          pendingPromptRef.current = null;
          port.close();
          if (selectedNodeId) {
            setSelectedNode(selectedNodeId);
          }
        },
        onClose: () => {
          if (pendingPromptRef.current) {
            deleteNode(pendingPromptRef.current);
            pendingPromptRef.current = null;
          }
          port.close();
        },
      });
      port.open();
    },
    [deleteNode, port, setNode, setSelectedNode],
  );

  return { handlePromptDragEnd, pendingPromptRef };
}
