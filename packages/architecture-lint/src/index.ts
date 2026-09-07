import { lintBoundarySignatureMirrors } from "./boundary-signature-mirrors.ts";
import { relative, resolve } from "node:path";
import { lintApplicationBoundaries } from "./application-boundaries.ts";
import { lintApiTransportBoundaries } from "./api-transport-boundaries.ts";
import { lintApiTransportFramework } from "./api-transport-framework.ts";
import { lintArchitectureRecords } from "./architecture-records.ts";
import { lintCycles } from "./cycles.ts";
import { changedSourceFiles } from "./comment-blocks.ts";
import { lintStrictContractBuildConfigs } from "./contract-build-config.ts";
import { lintDeclarations } from "./declarations.ts";
import { lintDeclarationProjectReferences } from "./declaration-project-references.ts";
import { lintEventingRoles } from "./eventing-roles.ts";
import { lintFeatureConfiguration } from "./feature-configuration.ts";
import { lintEnterpriseSourceLicense } from "./enterprise-source-license.ts";
import { lintFeatureLayouts } from "./feature-layout.ts";
import { lintPrismaTableOwnership } from "./prisma-table-ownership.ts";
import { lintFrontendUiBoundaries } from "./frontend-ui-boundaries.ts";
import { lintGlobalAppAccess } from "./global-app-access.ts";
import { lintLegacyFeatureFragments } from "./legacy-feature-fragments.ts";
import { lintManifests } from "./manifests.ts";
import { lintOverengineeringBaseline } from "./overengineering.ts";
import { lintStrictPortModules } from "./port-modules.ts";
import { lintServiceCeilings } from "./service-ceilings.ts";
import { lintServiceProjectionBoundaries } from "./service-projection-boundaries.ts";
import { lintTestQuality } from "./test-quality.ts";
import type { ArchitectureViolation, LintWorkspaceOptions } from "./types.ts";
import { discoverClassifiedPackages } from "./workspace.ts";

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
export { readFeatureCatalogue } from "./feature-catalogue.ts";
export { lintFeatureConfiguration } from "./feature-configuration.ts";
export {
  boundaryEdgesFromViolations,
  compareBoundaryEdgeBaseline,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
} from "./boundary-edge-baseline.ts";
export type {
  BoundaryEdge,
  BoundaryEdgeBaselineCheck,
  BoundaryEdgeEntry,
  BoundaryEdgeKind,
} from "./boundary-edge-baseline.ts";
export { lintApiTransportBoundaries } from "./api-transport-boundaries.ts";
export {
  apiTransportFrameworkFindings,
  featureServerTransportFindings,
  lintApiTransportFramework,
  readApiTransportFrameworkAllowlist,
} from "./api-transport-framework.ts";
export {
  changedSourceFiles,
  compareCommentBlockRoots,
  lintCommentBlocks,
  lintCommentBlockRoots,
} from "./comment-blocks.ts";
export type {
  CommentBlockLintOptions,
  CommentBlockLintResult,
  CommentBlockReview,
  CommentBlockRootEntry,
  CommentBlockRootsBaselineCheck,
} from "./comment-blocks.ts";
export type {
  LegacyApplicationBoundaryEdge,
  LegacyApplicationBoundaryKind,
} from "./application-boundaries.ts";
export {
  collectLegacyApplicationBoundaryEdges,
  formatLegacyApplicationBoundaryBaseline,
} from "./application-boundaries.ts";
export type {
  LegacyFeatureFragment,
  LegacyFeatureFragmentKind,
} from "./legacy-feature-fragments.ts";
export {
  collectLegacyFeatureFragments,
  formatLegacyFeatureFragmentBaseline,
} from "./legacy-feature-fragments.ts";
export { discoverClassifiedPackages } from "./workspace.ts";
export { lintFeatureLayouts } from "./feature-layout.ts";
export { lintFeatureSetupInfrastructure } from "./feature-setup-infrastructure.ts";
export { lintManifests } from "./manifests.ts";
export { formatServiceCeilingsBaseline } from "./service-ceilings.ts";
export { collectServiceCeilings } from "./service-ceilings.ts";
export { compareServiceCeilingsBaselines } from "./service-ceilings.ts";
export { readServiceCeilingsBaselineFile } from "./service-ceilings.ts";
export { lintServiceCeilingsBaseline } from "./service-ceilings.ts";
export { lintServiceCeilings } from "./service-ceilings.ts";
export { lintServiceCeilingsFile } from "./service-ceilings.ts";
export { lintServiceProjectionBoundaries } from "./service-projection-boundaries.ts";
export { lintStrictContractBuildConfigs } from "./contract-build-config.ts";
export { lintDeclarationProjectReferences } from "./declaration-project-references.ts";
export { lintFrontendUiBoundaries } from "./frontend-ui-boundaries.ts";
export type {
  ModuleImport,
  PackageManifestRecord,
  ValueImportGraph,
  WorkspaceModuleResolver,
} from "./module-graph.ts";
export {
  chainsToSeeds,
  createWorkspaceModuleResolver,
  moduleImports,
  rendersJsx,
  resolveRelativeModule,
  resolveSourceCandidate,
  valueImports,
  walkValueImportGraph,
} from "./module-graph.ts";
export { lintTestQuality } from "./test-quality.ts";
export type { TestQualityLintOptions } from "./test-quality.ts";
export {
  collectGlobalAppAccesses,
  formatGlobalAppAccessBaseline,
  lintGlobalAppAccess,
} from "./global-app-access.ts";
export {
  collectOverengineering,
  formatOverengineeringBaseline,
  lintOverengineeringBaseline,
} from "./overengineering.ts";
export { lintStrictPortModules } from "./port-modules.ts";
export { lintStrictPortBaseline } from "./port-modules.ts";
export { readStrictPortBaselineFile } from "./port-modules.ts";
export { collectStrictPortBaseline } from "./port-modules.ts";
export { formatStrictPortBaseline } from "./port-modules.ts";
export {
  collectComposedExportSubjects,
  collectUncomposedExports,
  formatComposedExportsBaseline,
  lintComposedExports,
  lintComposedExportsBaseline,
  reachableFiles,
  readComposedExportsBaselineFile,
  serverPackageIndexes,
} from "./composed-exports.ts";
export type { ComposedExportSubject } from "./composed-exports.ts";
export { lintTypedPrismaSeamBaseline } from "./typed-prisma-seam.ts";
export { readTypedPrismaSeamBaselineFile } from "./typed-prisma-seam.ts";
export { lintOxlintBaseline, readOxlintBaselineFile } from "./oxlint-baseline-check.ts";
export {
  applyFilenameMigration,
  collectFilenameMigrationMappings,
  planFilenameMigration,
} from "./filename-migration.ts";
export type { FilenameMigrationPlan, FilenameRename } from "./filename-migration.ts";

export function lintWorkspace(options: LintWorkspaceOptions): ArchitectureViolation[] {
  const root = resolve(options.root);
  const changedFiles = options.changedFiles ?? changedSourceFiles(root);
  const discovery = discoverClassifiedPackages(root);
  const violations = [
    ...discovery.violations,
    ...lintBoundarySignatureMirrors(root),
    ...lintEnterpriseSourceLicense(root),
    ...lintFeatureLayouts(root, discovery.packages),
    ...lintFeatureConfiguration(root, discovery.catalogue),
    ...lintPrismaTableOwnership(root, discovery.catalogue),
    ...lintFrontendUiBoundaries(root, discovery.packages),
    ...lintGlobalAppAccess(root),
    ...(options.legacyFeatureFragments === false
      ? []
      : lintLegacyFeatureFragments(root, discovery.catalogue, discovery.packages)),
    ...lintEventingRoles(root, discovery.packages),
    ...lintArchitectureRecords(discovery.packages),
    ...lintStrictContractBuildConfigs(root, discovery.packages),
    ...lintDeclarationProjectReferences(root, discovery.packages),
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
