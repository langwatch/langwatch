import { relative, resolve } from "node:path";
import { lintApplicationBoundaries } from "./application-boundaries";
import { lintArchitectureRecords } from "./architecture-records";
import { lintCycles } from "./cycles";
import { changedSourceFiles, lintCommentBlocks } from "./comment-blocks";
import { lintStrictContractBuildConfigs } from "./contract-build-config";
import { lintDeclarations } from "./declarations";
import { lintEventingRoles } from "./eventing-roles";
import { lintFeatureLayouts } from "./feature-layout";
import { lintLegacyFeatureFragments } from "./legacy-feature-fragments";
import { lintManifests } from "./manifests";
import { lintPrismaBoundaries } from "./prisma-boundaries";
import { lintStrictPortModules } from "./port-modules";
import { lintServiceResultContracts } from "./service-results";
import { lintServiceQuality } from "./service-quality";
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
export { changedSourceFiles, lintCommentBlocks } from "./comment-blocks";
export type {
  CommentBlockLintOptions,
  CommentBlockLintResult,
  CommentBlockReview,
} from "./comment-blocks";
export type {
  LegacyApplicationBoundaryEdge,
  LegacyApplicationBoundaryKind,
} from "./application-boundaries";
export {
  collectLegacyApplicationBoundaryEdges,
  formatLegacyApplicationBoundaryBaseline,
} from "./application-boundaries";
export type {
  LegacyFeatureFragment,
  LegacyFeatureFragmentKind,
} from "./legacy-feature-fragments";
export {
  collectLegacyFeatureFragments,
  formatLegacyFeatureFragmentBaseline,
} from "./legacy-feature-fragments";
export { discoverClassifiedPackages } from "./workspace";
export { formatServiceQualityBaseline } from "./service-quality";
export { collectServiceQualityCeilings } from "./service-quality";
export { compareServiceQualityBaselines } from "./service-quality";
export { readServiceQualityBaselineFile } from "./service-quality";
export { lintServiceQualityBaseline } from "./service-quality";
export { lintServiceQuality } from "./service-quality";
export { lintServiceQualityFile } from "./service-quality";
export { lintStrictContractBuildConfigs } from "./contract-build-config";
export { lintTestQuality } from "./test-quality";
export type { TestQualityLintOptions } from "./test-quality";
export { lintStrictPortModules } from "./port-modules";
export { lintStrictPortBaseline } from "./port-modules";
export { readStrictPortBaselineFile } from "./port-modules";
export { collectStrictPortBaseline } from "./port-modules";
export { formatStrictPortBaseline } from "./port-modules";
export {
  applyFilenameMigration,
  collectFilenameMigrationMappings,
  planFilenameMigration,
} from "./filename-migration";
export type { FilenameMigrationPlan, FilenameRename } from "./filename-migration";

export function lintWorkspace(
  options: LintWorkspaceOptions,
  commentBlocks?: ReturnType<typeof lintCommentBlocks>,
): ArchitectureViolation[] {
  const root = resolve(options.root);
  const changedFiles = options.changedFiles ?? changedSourceFiles(root);
  const resolvedCommentBlocks =
    commentBlocks ?? lintCommentBlocks(root, { files: changedFiles });
  const discovery = discoverClassifiedPackages(root);
  const violations = [
    ...discovery.violations,
    ...lintFeatureLayouts(discovery.packages, discovery.catalogue),
    ...(options.legacyFeatureFragments === false
      ? []
      : lintLegacyFeatureFragments(root, discovery.catalogue, discovery.packages)),
    ...lintEventingRoles(root, discovery.packages),
    ...lintArchitectureRecords(discovery.packages),
    ...lintStrictContractBuildConfigs(root, discovery.packages),
    ...lintStrictPortModules(root, discovery.packages),
    ...lintManifests(discovery.packages),
    ...lintApplicationBoundaries(root, discovery.packages, {
      legacyMigration: options.legacyApplicationMigration !== false,
    }),
    ...lintPrismaBoundaries(discovery.packages),
    ...lintServiceResultContracts(discovery.packages),
    ...lintServiceQuality(
      root,
      discovery.packages,
      options.serviceQualityBaselineReference,
    ),
    ...lintCycles(discovery.packages),
    ...resolvedCommentBlocks.violations,
    ...lintTestQuality(root, { files: changedFiles }),
    ...(options.declarations === false ? [] : lintDeclarations(discovery.packages)),
  ];
  return violations
    .map((violation) => ({
      ...violation,
      file: relative(root, violation.file) || violation.file,
    }))
    .sort((a, b) =>
      `${a.file}:${a.line ?? 0}:${a.policy}`.localeCompare(
        `${b.file}:${b.line ?? 0}:${b.policy}`,
      ),
    );
}

export function formatViolation(violation: ArchitectureViolation): string {
  const location = `${violation.file}${violation.line ? `:${violation.line}` : ""}`;
  const importText = violation.specifier ? ` (${violation.specifier})` : "";
  const allowed = violation.allowed ? `\n  allowed: ${violation.allowed}` : "";
  return `[${violation.policy}] ${location}${importText}\n  ${violation.message}${allowed}`;
}
