import type { Edge, Node } from "@xyflow/react";

/**
 * Control-flow connections wire an If/Else branch to a downstream NODE
 * rather than to one of its data inputs. A branch decides whether the next
 * node runs; it carries no value. So the branch lands on a dedicated
 * node-level target handle (the green control-flow point), and the edge is
 * marked as control flow so the engine gates on it without plumbing a value.
 */

/** React Flow id of the node-level control-flow target handle. */
export const CONTROL_FLOW_HANDLE_ID = "control";

/**
 * Edge `type` for a control-flow connection. The Go engine reads this to
 * gate the target without passing the branch boolean into its inputs (see
 * services/nlpgo/app/engine/engine.go resolveInputs).
 */
export const CONTROL_FLOW_EDGE_TYPE = "control";

const IF_ELSE = "if_else";
const BRANCH_HANDLES = new Set(["true", "false"]);

function stripOutputsPrefix(handle: string | null | undefined): string {
  if (!handle) return "";
  return handle.startsWith("outputs.")
    ? handle.slice("outputs.".length)
    : handle;
}

/** Whether a source handle is an If/Else branch handle (`outputs.true`/`false`). */
export function isBranchSourceHandle(
  handle: string | null | undefined,
): boolean {
  return BRANCH_HANDLES.has(stripOutputsPrefix(handle));
}

/**
 * Whether a drag originates from an If/Else node's branch handle, given the
 * dragged node and handle. This is what lights up the control-flow targets.
 */
export function isBranchConnectionOrigin({
  node,
  handleId,
}: {
  node: Node | undefined;
  handleId: string | null | undefined;
}): boolean {
  return node?.type === IF_ELSE && isBranchSourceHandle(handleId);
}

/** Whether a connection targets a node's control-flow handle. */
export function isControlFlowConnection(connection: {
  targetHandle?: string | null;
}): boolean {
  return connection.targetHandle === CONTROL_FLOW_HANDLE_ID;
}

/** Whether an edge is a control-flow edge (gates execution, passes no value). */
export function isControlFlowEdge(
  edge: Pick<Edge, "type" | "targetHandle">,
): boolean {
  return (
    edge.type === CONTROL_FLOW_EDGE_TYPE ||
    edge.targetHandle === CONTROL_FLOW_HANDLE_ID
  );
}

/**
 * Whether a pending connection is allowed (React Flow isValidConnection).
 * A branch is control flow: it may only land on a node's control-flow
 * target, and that target only accepts a branch. Every other connection is
 * unaffected (normal data wiring keeps its own rules in onConnect).
 */
export function isConnectionAllowed({
  nodes,
  connection,
}: {
  nodes: Node[];
  connection: {
    source?: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  };
}): boolean {
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const fromBranch = isBranchConnectionOrigin({
    node: sourceNode,
    handleId: connection.sourceHandle,
  });
  const toControl = isControlFlowConnection(connection);
  if (fromBranch) return toControl;
  if (toControl) return fromBranch;
  return true;
}
