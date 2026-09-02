import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";

import { selectionColor } from "./workflow-nodes";
import { useWorkflowNodeHost } from "../elements/workflow-node.host";

/**
 * Default Workflow canvas edge. React Flow and the color-mode implementation
 * are application composition concerns; the edge's selection behaviour stays
 * with the Workflow browser surface.
 */
export function WorkflowEdge(props: EdgeProps) {
  const { useColorModeValue } = useWorkflowNodeHost();
  const highlighted = props.selected;

  const [edgePath] = getBezierPath(props);
  const edgeColor = useColorModeValue("#DDDDDD", "#3d3d4d");

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={props.markerEnd}
      style={{
        stroke: highlighted ? selectionColor : edgeColor,
        strokeWidth: highlighted ? 1.5 : 2,
      }}
    />
  );
}
