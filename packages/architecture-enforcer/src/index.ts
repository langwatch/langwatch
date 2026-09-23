import { relative, resolve } from "node:path";

import { POLICIES } from "./policies/index.ts";
import type { PolicyDefinition } from "./policies/index.ts";
import type { ArchitectureViolation, LintWorkspaceOptions } from "./types.ts";
import { changedSourceFiles } from "./workspace/changed-files.ts";
import { buildWorkspaceSnapshot } from "./workspace/snapshot.ts";
import type { WorkspaceSnapshot } from "./workspace/snapshot.ts";

export type {
  ApplicationPackageRole,
  ArchitectureViolation,
  ClassifiedPackage,
  FeatureCatalogueEntry,
  FeatureClassification,
  EnterpriseCompositionRole,
  LintWorkspaceOptions,
  PackageKind,
} from "./types.ts";
export type { PolicyDefinition } from "./policies/index.ts";
export { definePolicy, POLICIES } from "./policies/index.ts";
export { readFeatureCatalogue } from "./workspace/feature-catalogue.ts";
export { lintFeatureConfiguration } from "./policies/feature-configuration.ts";
export { changedSourceFiles } from "./workspace/changed-files.ts";
export { buildWorkspaceSnapshot, discoverClassifiedPackages } from "./workspace/snapshot.ts";
export type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
export { walkFiles } from "./workspace/layout.ts";
export { getAnchor, MissingAnchorError } from "./workspace/anchors.ts";
export { lintFeatureLayouts } from "./policies/feature-layout.ts";
export { lintManifests } from "./policies/boundaries/manifests.ts";
export {
  lintServiceCeilings,
  lintServiceCeilingsFile,
} from "./policies/quality/service-ceilings.ts";
export { lintServiceProjectionBoundaries } from "./policies/quality/service-projection-boundaries.ts";
export { lintStrictContractBuildConfigs } from "./policies/quality/contract-build-config.ts";
export { lintDeclarationProjectReferences } from "./policies/quality/declaration-project-references.ts";
export { lintBrowserNodeLeaks } from "./policies/frontend/browser-node-leak.ts";
export type {
  ModuleImport,
  PackageManifestRecord,
  ValueImportGraph,
  WorkspaceModuleResolver,
} from "./workspace/module-graph.ts";
export {
  chainsToSeeds,
  createWorkspaceModuleResolver,
  moduleImports,
  rendersJsx,
  resolveRelativeModule,
  resolveSourceCandidate,
  sourceFile,
  sourceText,
  valueImports,
  walkValueImportGraph,
} from "./workspace/module-graph.ts";
export { lintTestQuality } from "./policies/test-quality.ts";
export type { TestQualityLintOptions } from "./policies/test-quality.ts";
export {
  collectFeatureShapeFindings,
  FEATURE_SHAPE_LEGACY_KINDS,
  lintFeatureShape,
} from "./policies/feature-shape.ts";
export type { FeatureShapeFinding, FeatureShapeLegacyKind } from "./policies/feature-shape.ts";
export {
  collectSourceFolderShapeFindings,
  FOLDER_BUDGET,
  FRAGMENT_FLOOR,
  lintSourceFolderShape,
  SOURCE_FOLDER_SHAPE_KINDS,
} from "./policies/source-folder-shape.ts";
export type {
  SourceFolderShapeFinding,
  SourceFolderShapeKind,
} from "./policies/source-folder-shape.ts";
export {
  collectUnusedModuleExportFindings,
  lintUnusedModuleExports,
} from "./policies/quality/unused-module-export.ts";
export type { UnusedModuleExportFinding } from "./policies/quality/unused-module-export.ts";
export {
  collectMemoryTwinDriftFindings,
  lintMemoryTwinDrift,
  MEMORY_TWIN_DRIFT_SIDES,
} from "./policies/persistence/memory-twin-drift.ts";
export type {
  MemoryTwinDriftFinding,
  MemoryTwinDriftSide,
} from "./policies/persistence/memory-twin-drift.ts";
export {
  collectComposedExportSubjects,
  collectUncomposedExports,
  lintComposedExports,
  reachableFiles,
  serverPackageIndexes,
} from "./policies/quality/composed-exports.ts";
export type { ComposedExportSubject } from "./policies/quality/composed-exports.ts";

/** Needs `tsc -b` to have run, so `declarations: false` skips it rather than discarding it. */
const DECLARATIONS_POLICY = "declarations";

/** The registry entries a run calls: all, less `declarations` when asked, narrowed to `only`. */
export function enabledPolicies(
  options: Pick<LintWorkspaceOptions, "declarations" | "only"> = {},
): readonly PolicyDefinition[] {
  const only = options.only ? new Set(options.only) : void 0;

  return POLICIES.filter((policy) => {
    if (options.declarations === false && policy.id === DECLARATIONS_POLICY) return false;

    return only === void 0 || only.has(policy.id);
  });
}

export function lintWorkspace(options: LintWorkspaceOptions): ArchitectureViolation[] {
  const root = resolve(options.root);

  const snapshot = buildWorkspaceSnapshot({
    root,
    changedFiles: options.changedFiles ?? changedSourceFiles(root),
  });

  return lintPolicies(snapshot, enabledPolicies(options));
}

/** The whole registry against a snapshot the caller already built, so a run reads the tree once. */
export function lintSnapshot(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintPolicies(snapshot, POLICIES);
}

/** `lintSnapshot` against one registry, so a caller can run a chosen subset. */
export function lintPolicies(
  snapshot: WorkspaceSnapshot,
  policies: readonly PolicyDefinition[],
): ArchitectureViolation[] {
  const root = snapshot.root;

  const violations = [
    ...snapshot.discoveryViolations,
    ...policies.flatMap((policy) => policy.run(snapshot)),
  ];

  return violations
    .map((violation) => ({
      ...violation,
      file: relative(root, violation.file) || violation.file,
    }))
    .toSorted((a, b) =>
      `${a.file}:${a.line ?? 0}:${a.policy}`.localeCompare(`${b.file}:${b.line ?? 0}:${b.policy}`),
    );
}
