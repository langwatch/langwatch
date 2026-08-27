import type { XYPosition } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { useDragLayer } from "react-dnd";

import { ComponentNode } from "./workflow-nodes";
import type { WorkflowNodeDragItem } from "./workflow-node-draggable";

type WorkflowDragPreviewState = {
  isDragging: boolean;
  item: WorkflowNodeDragItem;
  currentOffset: XYPosition | null;
};

/** Canvas drag preview for Workflow palette nodes. */
export function WorkflowDragPreview() {
  const { isDragging, item, currentOffset } = useDragLayer<
    WorkflowDragPreviewState,
    WorkflowNodeDragItem
  >((monitor) => ({
    item: monitor.getItem(),
    currentOffset: monitor.getClientOffset(),
    isDragging: monitor.isDragging(),
  }));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (item.node && ref.current) {
      const { width, height } = ref.current.getBoundingClientRect();
      item.node.width = width;
      item.node.height = height;
    }
  }, [isDragging, item]);

  if (!isDragging) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 200,
        left: currentOffset?.x ?? 0,
        top: currentOffset?.y ?? 0,
        transform: "translate(-50%, -50%)",
        opacity: 0.5,
      }}
    >
      <ComponentNode
        ref={ref}
        id={item.node.id}
        type={item.node.type}
        data={item.node.data}
        draggable={false}
        width={item.node.width}
        height={item.node.height}
        deletable={false}
        selectable={false}
        selected={false}
        sourcePosition={undefined}
        targetPosition={undefined}
        dragHandle={undefined}
        parentId={undefined}
        zIndex={200}
        dragging={true}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    </div>
  );
}
