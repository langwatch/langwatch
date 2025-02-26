import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { selectionColor } from "./nodes/Nodes";
import { useColorRawValue } from "../../components/ui/color-mode";

export default function DefaultEdge(props: EdgeProps) {
  const { hoveredNodeId, nodes } = useWorkflowStore(
    ({ hoveredNodeId, nodes }) => ({
      hoveredNodeId,
      nodes,
    })
  );
  // Disable this for now, let's see how it looks like with many nodes
  const isConnectionHovered =
    0 && (hoveredNodeId === props.source || hoveredNodeId === props.target);
  const isConnectionSelected =
    0 &&
    nodes.some(
      (node) =>
        node.selected && (node.id === props.source || node.id === props.target)
    );
  const highlighted =
    !!props.selected || isConnectionHovered || isConnectionSelected;

  const [edgePath] = getBezierPath(props);

  const gray350 = useColorRawValue("gray.350", "#DDDDDD");

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={props.markerEnd}
        style={{
          stroke: highlighted ? selectionColor : gray350,
          strokeWidth: highlighted ? 1.5 : 2,
        }}
      />
    </>
  );
}
