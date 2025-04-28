/**
 * This is a custom set node that will automatically update the node internals
 */
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback } from "react";

import { useWorkflowStore } from "./useWorkflowStore";

export function useSmartSetNode() {
  const setNode = useWorkflowStore((state) => state.setNode);
  const updateNodeInternals = useUpdateNodeInternals();

  return useCallback(
    (node: Partial<Node> & { id: string }, newId?: string) => {
      setNode(node);
      updateNodeInternals(node.id);
    },
    [setNode, updateNodeInternals]
  );
}
