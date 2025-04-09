import { type Node } from "@xyflow/react";
import type { Component } from "../../../../../../../optimization_studio/types/dsl";

export const calculateNodePosition = (lastNode: Node<Component> | undefined) =>
  lastNode
    ? {
        x: lastNode.position.x + (lastNode.width ?? 0) + 200,
        y: lastNode.position.y,
      }
    : { x: 0, y: 0 };
