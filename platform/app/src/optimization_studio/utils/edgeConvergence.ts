import type { Connection, Edge, Node } from "@xyflow/react";

/**
 * Branch convergence: when more than one source may feed the same node
 * input.
 *
 * An input normally takes a single source. An If/Else fork is the
 * exception: its branches are mutually exclusive, so two branch outputs
 * can converge on one input and the engine deterministically keeps the
 * value of whichever branch actually ran (the not-taken branch is
 * skipped, contributing nothing). Sources that can run at the same time
 * (two independent nodes, or two outputs of one node) must NOT share an
 * input, because the engine's input resolution is order-dependent and
 * would silently pick a winner.
 *
 * This module decides, purely from the graph, whether a second source may
 * join an input. It mirrors the Go engine's branch gating
 * (runState.shouldSkip in services/nlpgo/app/engine/engine.go).
 */

/**
 * A constraint that must hold for a node to execute: an If/Else gate node
 * id and the branch side it must take, e.g. `"gate-1:true"`. A node's
 * guard set is the conjunction of constraints that hold on EVERY execution
 * path reaching it - its necessary conditions.
 */
type Guard = string;

const IF_ELSE = "if_else";
const BRANCH_HANDLES = new Set(["true", "false"]);

function stripPrefix(
  handle: string | null | undefined,
  prefix: string,
): string {
  if (!handle) return "";
  return handle.startsWith(prefix) ? handle.slice(prefix.length) : handle;
}

function intersect(sets: Set<Guard>[]): Set<Guard> {
  if (sets.length === 0) return new Set();
  let acc = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    const next = sets[i]!;
    acc = new Set([...acc].filter((g) => next.has(g)));
  }
  return acc;
}

/**
 * Computes the necessary If/Else guards for every node in the graph.
 *
 * Rules (matching the engine):
 *  - An edge from an If/Else node's `true`/`false` handle is a gate: the
 *    target only runs when that gate takes that side. Connecting BOTH
 *    handles of one gate makes a merge point - the gate must be alive but
 *    neither side is required. Gates dominate: a gated node is skipped
 *    when its gate is not taken regardless of any plain data edges.
 *  - Otherwise a node runs when ANY of its data sources ran, so the only
 *    necessary guards are the ones common to all of those sources.
 */
export function computeNodeGuards({
  nodes,
  edges,
}: {
  nodes: Node[];
  edges: Edge[];
}): Map<string, Set<Guard>> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgesByTarget = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!e.target) continue;
    const list = edgesByTarget.get(e.target);
    if (list) list.push(e);
    else edgesByTarget.set(e.target, [e]);
  }

  const memo = new Map<string, Set<Guard>>();
  const inProgress = new Set<string>();

  const guardsOf = (id: string): Set<Guard> => {
    const cached = memo.get(id);
    if (cached) return cached;
    // A valid workflow DAG is acyclic; if a cycle is ever present treat it
    // as no guarantee so this computation always terminates.
    if (inProgress.has(id)) return new Set();
    inProgress.add(id);

    const inbound = edgesByTarget.get(id) ?? [];
    let result: Set<Guard>;
    if (inbound.length === 0) {
      result = new Set();
    } else {
      const gateSides = new Map<string, Set<string>>();
      const dataSources: string[] = [];
      for (const e of inbound) {
        if (!e.source) continue;
        const src = nodeById.get(e.source);
        const srcKey = stripPrefix(e.sourceHandle, "outputs.");
        if (src?.type === IF_ELSE && BRANCH_HANDLES.has(srcKey)) {
          const sides = gateSides.get(e.source) ?? new Set<string>();
          sides.add(srcKey);
          gateSides.set(e.source, sides);
        } else {
          dataSources.push(e.source);
        }
      }
      if (gateSides.size > 0) {
        result = new Set();
        for (const [gateId, sides] of gateSides) {
          for (const g of guardsOf(gateId)) result.add(g);
          if (sides.size === 1) {
            result.add(`${gateId}:${[...sides][0]!}`);
          }
        }
      } else {
        result = intersect(dataSources.map((s) => guardsOf(s)));
      }
    }

    inProgress.delete(id);
    memo.set(id, result);
    return result;
  };

  for (const n of nodes) guardsOf(n.id);
  return memo;
}

/**
 * Two sources are mutually exclusive when their necessary guards disagree
 * on a gate: one requires the `true` side and the other the `false` side,
 * so they can never both produce a value in the same run.
 */
export function guardsAreMutuallyExclusive(
  a: Set<Guard>,
  b: Set<Guard>,
): boolean {
  for (const g of a) {
    const sep = g.lastIndexOf(":");
    const gate = g.slice(0, sep);
    const side = g.slice(sep + 1);
    const opposite = `${gate}:${side === "true" ? "false" : "true"}`;
    if (b.has(opposite)) return true;
  }
  return false;
}

/**
 * Whether a new connection may join an input that already has source(s).
 * Allowed only when the new source is mutually exclusive with EVERY
 * existing source on that input, so at runtime at most one of them ever
 * produces a value. A first source (no existing edge) is always allowed.
 */
export function canConvergeOnInput({
  nodes,
  edges,
  connection,
}: {
  nodes: Node[];
  edges: Edge[];
  connection: Connection;
}): boolean {
  if (!connection.source) return false;
  const existingSources = edges
    .filter(
      (e) =>
        e.target === connection.target &&
        e.targetHandle === connection.targetHandle,
    )
    .map((e) => e.source)
    .filter((s): s is string => Boolean(s));
  if (existingSources.length === 0) return true;

  const guards = computeNodeGuards({ nodes, edges });
  const newGuards = guards.get(connection.source) ?? new Set<Guard>();
  return existingSources.every((s) =>
    guardsAreMutuallyExclusive(newGuards, guards.get(s) ?? new Set<Guard>()),
  );
}
