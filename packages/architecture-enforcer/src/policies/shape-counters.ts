import { join, relative, sep } from "node:path";

import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "../baseline.ts";
import type { ArchitectureViolation } from "../types.ts";
import { listFiles } from "../workspace/layout.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";

/**
 * One counter the strict-layout drive tracks by hand
 * (`dev/scripts/shape-counters.sh`), turned into a lint with a baseline that
 * may only shrink: a ports/adapters folder the module shape retired.
 * `rest-door-without-mount`, `composition-root-may-only-shrink` and
 * `mount-file-is-one-call` were retired alongside it — each named a file
 * ARCHITECTURE.md's process shape (§4, ~40-line mains; §8, module-declared
 * `defineRestRouter`) had already deleted, so every one of them passed
 * vacuously.
 */

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

// --- ports-and-adapters-folders ---------------------------------------------

const PORTS_ADAPTERS_BASELINE_FILE = "ports-and-adapters-folders-baseline.json";
const PORTS_ADAPTERS_PATH = /^(?:enterprise\/)?modules\/[^/]+\/process\/src\/(?:ports|adapters)\//;

function isPortsOrAdaptersFile(path: string): boolean {
  return /\.tsx?$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path);
}

/** Every file under a `ports/` or `adapters/` folder the annotation shape retired. */
export function collectPortsAndAdaptersFoldersFindings(root: string): string[] {
  return listFiles({
    directory: root,
    accept: (path) =>
      isPortsOrAdaptersFile(path) && PORTS_ADAPTERS_PATH.test(workspacePath(root, path)),
  })
    .map((path) => workspacePath(root, path))
    .toSorted();
}

export const PORTS_AND_ADAPTERS_FOLDERS_BASELINE: BaselinePolicy = {
  id: "ports-and-adapters-folders",
  file: PORTS_ADAPTERS_BASELINE_FILE,
  label: "Ports and adapters folders baseline",
  keyRule: "A key is the file's workspace-relative path.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Ports and adapters folders baseline entry "${entry.key}" no longer exists and must be removed.`,
  }),
};

export function collectPortsAndAdaptersFoldersBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectPortsAndAdaptersFoldersFindings(root);

  return collectBaseline({ policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE, found, previous });
}

export function lintPortsAndAdaptersFolders(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const file = baselinePath({ root, policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE });
  const baseline = readBaseline({ policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE, file });

  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE, file }),
  ];

  const findings = collectPortsAndAdaptersFoldersFindings(root);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings);

  for (const path of findings) {
    if (baselined.has(path)) continue;

    violations.push({
      policy: "ports-and-adapters-folders",
      file: join(root, path),
      message: `"${path}" lives under a ports/adapters folder, which the module shape retired.`,
      allowed:
        "Repositories go to repositories/<tier>/, technical ports fold into <F>Infrastructure, module-owned implementations go to services/.",
    });
  }

  violations.push(
    ...staleRows({
      entries: baseline.entries,
      found,
      policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE,
      file,
    }),
  );

  return violations;
}
