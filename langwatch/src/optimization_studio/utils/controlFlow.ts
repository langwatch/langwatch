import type { Node } from "@xyflow/react";

/**
 * If/Else branch routing. A branch (the `true` / `false` output of an If/Else
 * node) routes execution down one path AND carries its boolean value, so it
 * connects like a normal edge into a bool input. To make wiring obvious, while
 * a branch is being dragged every connectable node grows a temporary green
 * "gate" bool input; dropping onto it materializes a real `gate` input wired
 * to the branch (see workflowStoreCore.onConnect). The engine gates the target
 * on the branch and passes the branch boolean into that input.
 */

/** Identifier of the bool input a branch lands on by default. */
export const GATE_FIELD = "gate";

/** React Flow target handle id of the gate input. */
export const GATE_HANDLE_ID = `inputs.${GATE_FIELD}`;

const IF_ELSE = "if_else";
const BRANCH_HANDLES = new Set(["true", "false"]);

function stripPrefix(
  handle: string | null | undefined,
  prefix: string,
): string {
  if (!handle) return "";
  return handle.startsWith(prefix) ? handle.slice(prefix.length) : handle;
}

type FieldLike = { identifier: string; type?: string };

function nodeInputs(node: Node | undefined): FieldLike[] {
  const inputs = (node?.data as { inputs?: FieldLike[] } | undefined)?.inputs;
  return Array.isArray(inputs) ? inputs : [];
}

/** Whether a source handle is an If/Else branch handle (`outputs.true`/`false`). */
export function isBranchSourceHandle(
  handle: string | null | undefined,
): boolean {
  return BRANCH_HANDLES.has(stripPrefix(handle, "outputs."));
}

/** Whether a drag originates from an If/Else node's branch handle. */
export function isBranchConnectionOrigin({
  node,
  handleId,
}: {
  node: Node | undefined;
  handleId: string | null | undefined;
}): boolean {
  return node?.type === IF_ELSE && isBranchSourceHandle(handleId);
}

/** Whether the node already has a `gate` input (so no temporary gate is offered). */
export function nodeHasGateInput(node: Node | undefined): boolean {
  return nodeInputs(node).some((f) => f.identifier === GATE_FIELD);
}

/**
 * Whether a node should grow a temporary gate input while a branch is dragged:
 * any node that takes inputs and does not already have a gate. The drag's own
 * source node, the entry (source-only) node, and prompting_technique (which
 * attaches to a node and has no inputs) are excluded.
 */
export function showsTemporaryGate({
  node,
  sourceId,
}: {
  node: { id: string; type?: string; data?: unknown };
  sourceId: string | null;
}): boolean {
  if (node.id === sourceId) return false;
  if (node.type === "entry" || node.type === "prompting_technique") {
    return false;
  }
  return !nodeHasGateInput(node as Node);
}

/**
 * Whether a pending connection is allowed (React Flow isValidConnection).
 * A branch carries a boolean, so it may only land on a bool input (an existing
 * bool input or the gate). Self-connections are rejected. Every non-branch
 * connection keeps its own rules in onConnect.
 */
export function isConnectionAllowed({
  nodes,
  connection,
}: {
  nodes: Node[];
  connection: {
    source?: string | null;
    sourceHandle?: string | null;
    target?: string | null;
    targetHandle?: string | null;
  };
}): boolean {
  if (connection.source && connection.source === connection.target) {
    return false;
  }
  const sourceNode = nodes.find((n) => n.id === connection.source);
  if (
    !isBranchConnectionOrigin({
      node: sourceNode,
      handleId: connection.sourceHandle,
    })
  ) {
    return true;
  }
  // The gate (temporary or real) is bool by construction.
  if (connection.targetHandle === GATE_HANDLE_ID) return true;
  const targetNode = nodes.find((n) => n.id === connection.target);
  const inputId = stripPrefix(connection.targetHandle, "inputs.");
  const input = nodeInputs(targetNode).find((f) => f.identifier === inputId);
  return input?.type === "bool";
}
