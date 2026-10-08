import { join } from "node:path";

import type { ArchitectureViolation } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { readWorkspaceMembers } from "../../workspace/tsconfig-references.ts";
import { manifestDependencies } from "./manifests.ts";

export function lintCycles(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const manifestPaths = new Map<string, string>();
  const declared = new Map<string, string[]>();

  // devDependencies count: Nx orders `^typecheck` over them too (ADR-150).
  for (const pkg of snapshot.packages) {
    const edges = { ...pkg.manifest.devDependencies, ...manifestDependencies(pkg.manifest) };
    declared.set(pkg.name, Object.keys(edges));
    manifestPaths.set(pkg.name, pkg.manifestPath);
  }

  // `packages/*` is no snapshot package, yet a cycle through one still refuses the task graph.
  for (const member of readWorkspaceMembers(snapshot.root)) {
    if (declared.has(member.name)) continue;
    declared.set(member.name, [...member.dependencies, ...member.developmentDependencies]);
    manifestPaths.set(member.name, join(member.directory, "package.json"));
  }

  const graph = new Map<string, string[]>();
  for (const [name, targets] of declared) {
    graph.set(name, targets.filter((target) => declared.has(target)).toSorted());
  }

  return stronglyConnected(graph)
    .filter(
      (members) => members.length > 1 || graph.get(members[0] ?? "")?.includes(members[0] ?? ""),
    )
    .map((members) => members.toSorted())
    .toSorted((left, right) => (left[0] ?? "").localeCompare(right[0] ?? ""))
    .map((members) => {
      const first = members[0] ?? "";

      return {
        policy: "package-cycle",
        file: manifestPaths.get(first) ?? "package.json",
        message: `Package dependency cycle: ${shortestCycle({ graph, members, start: first }).join(" -> ")}; strongly connected with ${members.length} packages: ${members.join(", ")}`,
        allowed:
          "Cut one edge inside the component: drop the dependency, or invert it so the callers pass what it needed",
      };
    });
}

type Tarjan = {
  graph: ReadonlyMap<string, readonly string[]>;
  index: Map<string, number>;
  lowLink: Map<string, number>;
  onStack: Set<string>;
  stack: string[];
  components: string[][];
};

/** Every strongly connected component of the graph (Tarjan), each with all its members. */
function stronglyConnected(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const state: Tarjan = {
    graph,
    index: new Map(),
    lowLink: new Map(),
    onStack: new Set(),
    stack: [],
    components: [],
  };

  for (const name of [...graph.keys()].toSorted()) if (!state.index.has(name)) visit(state, name);

  return state.components;
}

function visit(state: Tarjan, name: string): void {
  state.index.set(name, state.index.size);
  state.lowLink.set(name, state.index.size - 1);
  state.stack.push(name);
  state.onStack.add(name);

  for (const target of state.graph.get(name) ?? []) {
    if (!state.index.has(target)) visit(state, target);
    else if (!state.onStack.has(target)) continue;

    const reach = state.onStack.has(target) ? (state.lowLink.get(target) ?? 0) : Infinity;
    state.lowLink.set(name, Math.min(state.lowLink.get(name) ?? 0, reach));
  }

  if (state.lowLink.get(name) === state.index.get(name)) popComponent(state, name);
}

function popComponent(state: Tarjan, root: string): void {
  const component: string[] = [];
  let member = state.stack.pop();
  while (member !== undefined) {
    state.onStack.delete(member);
    component.push(member);
    if (member === root) break;
    member = state.stack.pop();
  }
  state.components.push(component);
}

/** The shortest way from `start` back to itself inside the component: one concrete cycle. */
function shortestCycle({
  graph,
  members,
  start,
}: {
  graph: ReadonlyMap<string, readonly string[]>;
  members: readonly string[];
  start: string;
}): string[] {
  const inside = new Set(members);
  const previous = new Map<string, string>();
  const queue = [start];

  for (let head = 0; head < queue.length; head += 1) {
    const name = queue[head] ?? "";
    for (const target of graph.get(name) ?? []) {
      if (target === start) {
        const path = [name];
        while (path[0] !== start) path.unshift(previous.get(path[0] ?? "") ?? start);
        return [...path, start];
      }
      if (!inside.has(target) || previous.has(target)) continue;
      previous.set(target, name);
      queue.push(target);
    }
  }

  return [start, start];
}
