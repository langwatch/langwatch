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
    graph.set(
      name,
      targets.filter((target) => declared.has(target)),
    );
  }

  const active = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  const visit = (name: string) => {
    if (active.has(name)) {
      const start = stack.indexOf(name);
      cycles.add([...stack.slice(start), name].join(" -> "));

      return;
    }

    if (visited.has(name)) return;

    visited.add(name);
    active.add(name);
    stack.push(name);
    for (const target of graph.get(name) ?? []) visit(target);

    stack.pop();
    active.delete(name);
  };

  for (const name of graph.keys()) visit(name);

  return [...cycles].toSorted().map((cycle) => ({
    policy: "package-cycle",
    file: manifestPaths.get(cycle.split(" -> ")[0] ?? "") ?? "package.json",
    message: `Package dependency cycle: ${cycle}`,
  }));
}
