import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useColorModeValue } from "../../components/ui/color-mode";
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

  // Hardcoded to the pre-redesign edge grays (old gray.350 in light, gray.600
  // in dark). The gray scale shift darkened gray.400, making the connecting
  // lines read much heavier than they did for years; pin them to the old look.
  const edgeColor = useColorModeValue("#DDDDDD", "#3d3d4d");

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
