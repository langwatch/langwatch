import { relative, resolve } from "node:path";
import { lintApplicationBoundaries } from "./application-boundaries";
import { lintApiTransportBoundaries } from "./api-transport-boundaries";
import { lintApiTransportFramework } from "./api-transport-framework";
import { lintArchitectureRecords } from "./architecture-records";
import { lintCycles } from "./cycles";
import { changedSourceFiles } from "./comment-blocks";
import { lintStrictContractBuildConfigs } from "./contract-build-config";
import { lintDeclarations } from "./declarations";
import { lintEventingRoles } from "./eventing-roles";
import { lintFeatureLayouts } from "./feature-layout";
import { lintFrontendUiBoundaries } from "./frontend-ui-boundaries";
import { lintGlobalAppAccess } from "./global-app-access";
import { lintLegacyFeatureFragments } from "./legacy-feature-fragments";
import { lintManifests } from "./manifests";
import { lintOverengineeringBaseline } from "./overengineering";
import { lintStrictPortModules } from "./port-modules";
import { lintServiceCeilings } from "./service-ceilings";
import { lintServiceProjectionBoundaries } from "./service-projection-boundaries";
import { lintTestQuality } from "./test-quality";
import type { ArchitectureViolation, LintWorkspaceOptions } from "./types";
import { discoverClassifiedPackages } from "./workspace";

export type {
  ApplicationPackageRole,
  ArchitectureViolation,
  ClassifiedPackage,
  FeatureCatalogueEntry,
  FeatureClassification,
  EnterpriseCompositionRole,
  LintWorkspaceOptions,
  PackageKind,
} from "./types";
export { readFeatureCatalogue } from "./feature-catalogue";
export {
  boundaryEdgesFromViolations,
  compareBoundaryEdgeBaseline,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
} from "./boundary-edge-baseline";
export type {
  BoundaryEdge,
  BoundaryEdgeBaselineCheck,
  BoundaryEdgeEntry,
  BoundaryEdgeKind,
} from "./boundary-edge-baseline";
export { lintApiTransportBoundaries } from "./api-transport-boundaries";
export {
  apiTransportFrameworkFindings,
  lintApiTransportFramework,
  readApiTransportFrameworkAllowlist,
} from "./api-transport-framework";
export {
  changedSourceFiles,
  compareCommentBlockRoots,
  lintCommentBlocks,
  lintCommentBlockRoots,
} from "./comment-blocks";
export type {
  CommentBlockLintOptions,
  CommentBlockLintResult,
  CommentBlockReview,
  CommentBlockRootEntry,
  CommentBlockRootsBaselineCheck,
} from "./comment-blocks";
export type {
  LegacyApplicationBoundaryEdge,
  LegacyApplicationBoundaryKind,
} from "./application-boundaries";
export {
  collectLegacyApplicationBoundaryEdges,
  formatLegacyApplicationBoundaryBaseline,
} from "./application-boundaries";
export type { LegacyFeatureFragment, LegacyFeatureFragmentKind } from "./legacy-feature-fragments";
export {
  collectLegacyFeatureFragments,
  formatLegacyFeatureFragmentBaseline,
} from "./legacy-feature-fragments";
export { discoverClassifiedPackages } from "./workspace";
export { lintFeatureLayouts } from "./feature-layout";
export { lintManifests } from "./manifests";
export { formatServiceCeilingsBaseline } from "./service-ceilings";
export { collectServiceCeilings } from "./service-ceilings";
export { compareServiceCeilingsBaselines } from "./service-ceilings";
export { readServiceCeilingsBaselineFile } from "./service-ceilings";
export { lintServiceCeilingsBaseline } from "./service-ceilings";
export { lintServiceCeilings } from "./service-ceilings";
export { lintServiceCeilingsFile } from "./service-ceilings";
export { lintServiceProjectionBoundaries } from "./service-projection-boundaries";
export { lintStrictContractBuildConfigs } from "./contract-build-config";
export { lintFrontendUiBoundaries } from "./frontend-ui-boundaries";
export type {
  ModuleImport,
  PackageManifestRecord,
  ValueImportGraph,
  WorkspaceModuleResolver,
} from "./module-graph";
export {
  chainsToSeeds,
  createWorkspaceModuleResolver,
  moduleImports,
  rendersJsx,
  resolveRelativeModule,
  resolveSourceCandidate,
  valueImports,
  walkValueImportGraph,
} from "./module-graph";
export { lintTestQuality } from "./test-quality";
export type { TestQualityLintOptions } from "./test-quality";
export {
  collectGlobalAppAccesses,
  formatGlobalAppAccessBaseline,
  lintGlobalAppAccess,
} from "./global-app-access";
export {
  collectOverengineering,
  formatOverengineeringBaseline,
  lintOverengineeringBaseline,
} from "./overengineering";
export { lintStrictPortModules } from "./port-modules";
export { lintStrictPortBaseline } from "./port-modules";
export { readStrictPortBaselineFile } from "./port-modules";
export { collectStrictPortBaseline } from "./port-modules";
export { formatStrictPortBaseline } from "./port-modules";
export { lintTypedPrismaSeamBaseline } from "./typed-prisma-seam";
export { readTypedPrismaSeamBaselineFile } from "./typed-prisma-seam";
export { lintOxlintBaseline, readOxlintBaselineFile } from "./oxlint-baseline-check";
export {
  applyFilenameMigration,
  collectFilenameMigrationMappings,
  planFilenameMigration,
} from "./filename-migration";
export type { FilenameMigrationPlan, FilenameRename } from "./filename-migration";

export function lintWorkspace(options: LintWorkspaceOptions): ArchitectureViolation[] {
  const root = resolve(options.root);
  const changedFiles = options.changedFiles ?? changedSourceFiles(root);
  const discovery = discoverClassifiedPackages(root);
  const violations = [
    ...discovery.violations,
    ...lintFeatureLayouts(root, discovery.packages),
    ...lintFrontendUiBoundaries(root, discovery.packages),
    ...lintGlobalAppAccess(root),
    ...(options.legacyFeatureFragments === false
      ? []
      : lintLegacyFeatureFragments(root, discovery.catalogue, discovery.packages)),
    ...lintEventingRoles(root, discovery.packages),
    ...lintArchitectureRecords(discovery.packages),
    ...lintStrictContractBuildConfigs(root, discovery.packages),
    ...lintStrictPortModules(root, discovery.packages),
    ...lintManifests(discovery.packages),
    ...lintOverengineeringBaseline(root, discovery.packages),
    ...lintApplicationBoundaries(root, discovery.packages, {
      legacyMigration: options.legacyApplicationMigration !== false,
    }),
    ...lintApiTransportBoundaries(root, discovery.packages),
    ...lintApiTransportFramework(root, discovery.packages),
    ...lintServiceProjectionBoundaries(discovery.packages),
    ...lintServiceCeilings(root, discovery.packages, options.serviceCeilingsBaselineReference),
    ...lintCycles(discovery.packages),
    ...lintTestQuality(root, { files: changedFiles }),
    ...(options.declarations === false ? [] : lintDeclarations(discovery.packages)),
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

export function formatViolation(violation: ArchitectureViolation): string {
  const location = `${violation.file}${violation.line ? `:${violation.line}` : ""}`;
  const importText = violation.specifier ? ` (${violation.specifier})` : "";
  const allowed = violation.allowed ? `\n  allowed: ${violation.allowed}` : "";

  return `[${violation.policy}] ${location}${importText}\n  ${violation.message}${allowed}`;
}
