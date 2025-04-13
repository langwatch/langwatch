import type { workflowJsonSchema } from "../types/dsl";
import type { z } from "zod";
import type { Node } from "@xyflow/react";
import isDeepEqual from "fast-deep-equal";

export const clearDsl = (
  dsl: z.infer<typeof workflowJsonSchema>,
  includeExecutionStates = false
) => {
  return {
    ...dsl,
    version: undefined,
    edges: dsl.edges.map((edge) => {
      const edge_ = { ...edge };
      delete edge_.selected;
      return edge_;
    }),
    nodes: dsl.nodes.map((node: Node) => {
      const node_ = {
        ...node,
        data: { ...node.data },
        // Avoid floating point precision issues due to postgres JSONB storage
        position: {
          x: parseFloat(node.position.x.toFixed(4)),
          y: parseFloat(node.position.y.toFixed(4)),
        },
      };
      delete node_.selected;
      if (!includeExecutionStates) {
        delete node_.data.execution_state;
      }
      return node_;
    }),
    state: includeExecutionStates ? dsl.state : undefined,
  };
};

export const hasDSLChanged = (
  dslCurrent: z.infer<typeof workflowJsonSchema>,
  dslPrevious: z.infer<typeof workflowJsonSchema>,
  includeExecutionStates: boolean
) => {
  return !isDeepEqual(
    clearDsl(dslCurrent, includeExecutionStates),
    clearDsl(dslPrevious, includeExecutionStates)
  );
};
