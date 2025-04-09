import { type Node, Position } from "@xyflow/react";
import type { Component } from "../../../../../../../optimization_studio/types/dsl";
import { nanoid } from "nanoid";

export const calculateNodePosition = (lastNode: Node<Component> | undefined) =>
  lastNode
    ? {
        x: lastNode.position.x + (lastNode.width ?? 0) + 200,
        y: lastNode.position.y,
      }
    : { x: 0, y: 0 };

export const createBaseNode = <T extends Component>(
  type: string,
  data: T,
  position: { x: number; y: number }
): Node<T> => ({
  id: nanoid(),
  type,
  position,
  data,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
});
