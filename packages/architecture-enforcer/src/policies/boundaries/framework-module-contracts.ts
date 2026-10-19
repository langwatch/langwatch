import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

import type { ArchitectureViolation, PackageManifest } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Framework packages depend on no module contract (ARCHITECTURE.md §10.1, Alex 2026-10-01):
 * a feature type in `packages/*` is a central map every program compiles. Today's edges are
 * a shrink-only list, tests/baselines/framework-module-contracts.json (§17).
 */

const POLICY = "framework-module-contracts";
const FRAMEWORK_DIRECTORY = /^packages\/[^/]+$/;
const CONTRACT_DIRECTORY = /^(?:enterprise\/)?modules\/[^/]+\/contract$/;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export type FrameworkContractEdge = { framework: string; contract: string; manifestPath: string };

function workspaceRelative({ root, directory }: { root: string; directory: string }): string {
  return relative(root, directory).split(sep).join("/");
}

/** Every manifest edge from a `packages/*` package onto a module's contract, any field. */
export function frameworkContractEdges({
  snapshot,
}: {
  snapshot: WorkspaceSnapshot;
}): FrameworkContractEdge[] {
  const records = [...snapshot.resolver.packages.values()];
  const contracts = new Set(
    records
      .filter((record) =>
        CONTRACT_DIRECTORY.test(
          workspaceRelative({ root: snapshot.root, directory: record.directory }),
        ),
      )
      .map((record) => record.name),
  );
  const edges: FrameworkContractEdge[] = [];

  for (const record of records) {
    const directory = workspaceRelative({ root: snapshot.root, directory: record.directory });
    if (!FRAMEWORK_DIRECTORY.test(directory)) continue;

    const manifest: PackageManifest = JSON.parse(readFileSync(record.manifestPath, "utf8"));
    const names = new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));

    for (const name of [...names].toSorted()) {
      if (contracts.has(name))
        edges.push({ framework: directory, contract: name, manifestPath: record.manifestPath });
    }
  }

  return edges.toSorted((left, right) =>
    `${left.framework} ${left.contract}`.localeCompare(`${right.framework} ${right.contract}`),
  );
}

/** A baseline key for one edge: the framework package's directory and the contract's name. */
export function frameworkContractKey(edge: FrameworkContractEdge): string {
  return `${edge.framework} -> ${edge.contract}`;
}

export function lintFrameworkModuleContracts(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return frameworkContractEdges({ snapshot }).map((edge) => ({
    policy: POLICY,
    file: edge.manifestPath,
    specifier: edge.contract,
    message: `${edge.framework} depends on ${edge.contract}: a framework package knows no feature.`,
    allowed:
      "Let the owning module declare the type, token or query, and depend on the framework instead (ARCHITECTURE.md §10.1).",
  }));
}
