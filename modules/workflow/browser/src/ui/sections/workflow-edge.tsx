import { system } from "@langwatch/design-system/system";
import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";

import { selectionColor } from "./workflow-nodes.tsx";

/**
 * Default Workflow canvas edge. React Flow and the color-mode implementation
 * are application composition concerns; the edge's selection behaviour stays
 * with the Workflow browser surface.
 */
export function WorkflowEdge(props: EdgeProps) {
  const highlighted = props.selected;

  const [edgePath] = getBezierPath(props);
  const edgeColor = system.token.var("colors.border");

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
