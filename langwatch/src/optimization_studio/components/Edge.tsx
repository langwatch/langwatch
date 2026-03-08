import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useColorModeValue, useColorRawValue } from "../../components/ui/color-mode";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { selectionColor } from "./nodes/Nodes";

export default function DefaultEdge(props: EdgeProps) {
  const { hoveredNodeId, nodes } = useWorkflowStore(
    ({ hoveredNodeId, nodes }) => ({
      hoveredNodeId,
      nodes,
    }),
  );
  // Disable this for now, let's see how it looks like with many nodes
  const isConnectionHovered =
    0 && (hoveredNodeId === props.source || hoveredNodeId === props.target);
  const isConnectionSelected =
    0 &&
    nodes.some(
      (node) =>
        node.selected && (node.id === props.source || node.id === props.target),
    );
  const highlighted =
    !!props.selected || isConnectionHovered || isConnectionSelected;

  const [edgePath] = getBezierPath(props);

  const edgeColor = useColorModeValue(
    useColorRawValue("gray.350"),
    useColorRawValue("gray.600"),
  );

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={props.markerEnd}
        style={{
          stroke: highlighted ? selectionColor : edgeColor,
          strokeWidth: highlighted ? 1.5 : 2,
        }}
      />
    </>
  );
}
