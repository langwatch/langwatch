import { relative, resolve } from "node:path";
import { changedSourceFiles } from "./policies/quality/comment-blocks.ts";
import { POLICIES } from "./policies/index.ts";
import type { PolicyDefinition } from "./policies/index.ts";
import type { ArchitectureViolation, LintWorkspaceOptions } from "./types.ts";
import { buildWorkspaceSnapshot } from "./workspace/snapshot.ts";

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
export {
  BOUNDARY_EDGE_BASELINE,
  boundaryEdgeBaselineFile,
  boundaryEdgesFromViolations,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
} from "./policies/boundaries/boundary-edge-baseline.ts";
export type {
  BoundaryEdge,
  BoundaryEdgeBaselineCheck,
  BoundaryEdgeKind,
} from "./policies/boundaries/boundary-edge-baseline.ts";
export {
  BASELINE_VERSION,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  expiredRows,
  formatBaseline,
  liveKeys,
  readBaseline,
  shrinkCheck,
  staleRows,
} from "./baseline.ts";
export type { Baseline, BaselineEntry, BaselinePolicy } from "./baseline.ts";
export { lintApiTransportBoundaries, lintApiTransportFramework } from "./policies/api-transport.ts";
export {
  COMMENT_BLOCK_ROOTS_BASELINE,
  changedSourceFiles,
  lintCommentBlocks,
  lintCommentBlockRoots,
} from "./policies/quality/comment-blocks.ts";
export type {
  CommentBlockLintOptions,
  CommentBlockLintResult,
  CommentBlockReview,
  CommentBlockRootsBaselineCheck,
} from "./policies/quality/comment-blocks.ts";
export type {
  LegacyApplicationBoundaryEdge,
  LegacyApplicationBoundaryKind,
} from "./policies/boundaries/application-boundaries.ts";
export {
  collectLegacyApplicationBoundaryEdges,
  formatLegacyApplicationBoundaryBaseline,
} from "./policies/boundaries/application-boundaries.ts";
export type {
  LegacyFeatureFragment,
  LegacyFeatureFragmentKind,
} from "./policies/legacy-feature-fragments.ts";
export {
  collectLegacyFeatureFragments,
  formatLegacyFeatureFragmentBaseline,
} from "./policies/legacy-feature-fragments.ts";
export { buildWorkspaceSnapshot, discoverClassifiedPackages } from "./workspace/snapshot.ts";
export type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
import type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
export { walkFiles } from "./workspace/layout.ts";
export { lintFeatureLayouts } from "./policies/feature-layout.ts";
export {
  lintFeatureAppContracts,
  lintFeatureSetupInfrastructure,
} from "./policies/feature-app.ts";
export { lintManifests } from "./policies/boundaries/manifests.ts";
export {
  lintServiceCeilings,
  lintServiceCeilingsFile,
} from "./policies/quality/service-ceilings.ts";
export { lintServiceProjectionBoundaries } from "./policies/quality/service-projection-boundaries.ts";
export { lintStrictContractBuildConfigs } from "./policies/quality/contract-build-config.ts";
export { lintDeclarationProjectReferences } from "./policies/quality/declaration-project-references.ts";
export {
  declaredWebDependencyPairs,
  lintFrontendUiBoundaries,
} from "./policies/frontend/frontend-ui-boundaries.ts";
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
  collectGlobalAppAccesses,
  formatGlobalAppAccessBaseline,
  lintGlobalAppAccess,
} from "./policies/global-app-access.ts";
export {
  collectFeatureShapeBaseline,
  collectFeatureShapeFindings,
  FEATURE_SHAPE_BASELINE,
  FEATURE_SHAPE_LEGACY_KINDS,
  lintFeatureShape,
} from "./policies/feature-shape.ts";
export type { FeatureShapeFinding, FeatureShapeLegacyKind } from "./policies/feature-shape.ts";
export {
  collectSourceFolderShapeBaseline,
  collectSourceFolderShapeFindings,
  FOLDER_BUDGET,
  FRAGMENT_FLOOR,
  lintSourceFolderShape,
  SOURCE_FOLDER_SHAPE_BASELINE,
  SOURCE_FOLDER_SHAPE_KINDS,
} from "./policies/source-folder-shape.ts";
export type {
  SourceFolderShapeFinding,
  SourceFolderShapeKind,
} from "./policies/source-folder-shape.ts";
export { lintStrictPortModules } from "./policies/boundaries/port-modules.ts";
export {
  COMPOSED_EXPORTS_BASELINE,
  collectComposedExportSubjects,
  collectComposedExportsBaseline,
  collectUncomposedExports,
  lintComposedExports,
  lintComposedExportsBaseline,
  reachableFiles,
  serverPackageIndexes,
} from "./policies/quality/composed-exports.ts";
export type { ComposedExportSubject } from "./policies/quality/composed-exports.ts";
export {
  OXLINT_BASELINE,
  lintOxlintBaseline,
  oxlintBaselineFile,
  readOxlintBaseline,
} from "./policies/quality/oxlint-baseline-check.ts";
export {
  applyFilenameMigration,
  collectFilenameMigrationMappings,
  planFilenameMigration,
} from "./tools/filename-migration.ts";
export type { FilenameMigrationPlan, FilenameRename } from "./tools/filename-migration.ts";

/**
 * The registry ids a `false` option means "do not compute at all", because
 * disabling them once meant skipping their own call outright and every one
 * of their findings shares that one option — running them just to discard
 * the result is not free. `declarations` alone compiles a TypeScript
 * program per package to emit its `.d.ts` output; that is minutes, not
 * milliseconds, wasted for a caller who asked to skip it.
 */
const DECLARATIONS_POLICY = "declarations";
const LEGACY_FEATURE_FRAGMENTS_POLICY = "legacy-feature-fragments";

/** The registry entries `lintWorkspace` (and the CLI's check mode) actually calls, given its options. */
export function enabledPolicies(
  options: Pick<LintWorkspaceOptions, "declarations" | "legacyFeatureFragments"> = {},
): readonly PolicyDefinition[] {
  const skipped = new Set<string>();

  if (options.declarations === false) skipped.add(DECLARATIONS_POLICY);

  if (options.legacyFeatureFragments === false) skipped.add(LEGACY_FEATURE_FRAGMENTS_POLICY);

  return skipped.size === 0 ? POLICIES : POLICIES.filter((policy) => !skipped.has(policy.id));
}

/**
 * `application-boundaries` mixes edges the legacy-migration option can turn
 * off (`application-migration`, `application-migration-baseline`) with ones
 * it cannot (`application-boundary`), and the legacy checks are cheap
 * (no TypeScript program), so unlike the two above it always runs; a
 * `false` option only drops the findings its own `policy` field names.
 */
export function excludedPolicyIds(
  options: Pick<LintWorkspaceOptions, "legacyApplicationMigration">,
): ReadonlySet<string> {
  const excluded = new Set<string>();

  if (options.legacyApplicationMigration === false) {
    excluded.add("application-migration-baseline");
    excluded.add("application-migration");
  }

  return excluded;
}

export function lintWorkspace(options: LintWorkspaceOptions): ArchitectureViolation[] {
  const root = resolve(options.root);
  const snapshot = buildWorkspaceSnapshot({
    root,
    changedFiles: options.changedFiles ?? changedSourceFiles(root),
  });
  const excluded = excludedPolicyIds(options);

  return lintPolicies(snapshot, enabledPolicies(options)).filter(
    (violation) => !excluded.has(violation.policy),
  );
}

/**
 * The same run against a snapshot the caller already built, so a run reads
 * the tree once. Iterates the policy registry and nothing else — a library
 * caller of `lintSnapshot`/`lintWorkspace` and `pnpm lint` see the same set
 * of policies run. A caller after a subset calls `lintPolicies` with a
 * filtered registry (`enabledPolicies`) instead of discarding findings
 * after the fact, so an expensive policy asked to be skipped never runs.
 */
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
    .sort((a, b) =>
      `${a.file}:${a.line ?? 0}:${a.policy}`.localeCompare(`${b.file}:${b.line ?? 0}:${b.policy}`),
    );
}
