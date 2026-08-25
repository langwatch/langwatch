import { manifestDependencies } from "./manifests";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

export function lintCycles(packages: ClassifiedPackage[]): ArchitectureViolation[] {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const graph = new Map<string, string[]>();
  for (const pkg of packages) {
    graph.set(
      pkg.name,
      Object.keys(manifestDependencies(pkg.manifest)).filter((name) => byName.has(name)),
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
  return [...cycles].sort().map((cycle) => ({
    policy: "package-cycle",
    file: byName.get(cycle.split(" -> ")[0] ?? "")?.manifestPath ?? "package.json",
    message: `Feature package dependency cycle: ${cycle}`,
  }));
}
