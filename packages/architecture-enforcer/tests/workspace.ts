import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import type { WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import type { ClassifiedPackage, FeatureCatalogueEntry } from "../src/types.ts";

/**
 * A snapshot of a fixture tree. The walk, the resolver and the parse cache are
 * the real ones; `packages` and `catalogue` are overridable so a test can hand
 * a policy the classification it means to exercise.
 */
export function snapshotOf({
  root,
  packages,
  catalogue,
  changedFiles = [],
}: {
  root: string;
  packages?: readonly ClassifiedPackage[];
  catalogue?: readonly FeatureCatalogueEntry[];
  changedFiles?: readonly string[];
}): WorkspaceSnapshot {
  const snapshot = buildWorkspaceSnapshot({ root, changedFiles });

  return {
    ...snapshot,
    packages: packages ?? snapshot.packages,
    catalogue: catalogue ?? snapshot.catalogue,
  };
}
