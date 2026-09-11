import type { ArchitectureViolation } from "../types.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";
import { lintApplicationBoundaries } from "./boundaries/application-boundaries.ts";
import { lintArchitectureRecords } from "./boundaries/architecture-records.ts";
import { lintBoundarySignatureMirrors } from "./boundaries/boundary-signature-mirrors.ts";
import { lintCycles } from "./boundaries/cycles.ts";
import { lintEnterpriseSourceLicense } from "./boundaries/enterprise-source-license.ts";
import { lintManifests } from "./boundaries/manifests.ts";
import { lintStrictPortModules } from "./boundaries/port-modules.ts";
import { lintApiTransportBoundaries, lintApiTransportFramework } from "./api-transport.ts";
import { lintEventingRoles } from "./eventing-roles.ts";
import { lintFeatureConfiguration } from "./feature-configuration.ts";
import { lintFeatureLayouts } from "./feature-layout.ts";
import { lintFeatureAppContracts, lintFeatureSetupInfrastructure } from "./feature-app.ts";
import { lintFeatureShape } from "./feature-shape.ts";
import {
  declaredWebDependencyPairs,
  lintFrontendUiBoundaries,
} from "./frontend/frontend-ui-boundaries.ts";
import { lintGlobalAppAccess } from "./global-app-access.ts";
import { lintLegacyFeatureFragments } from "./legacy-feature-fragments.ts";
import {
  hasPrismaSchema,
  lintPrismaTableOwnership,
  prismaModelNames,
} from "./persistence/prisma-table-ownership.ts";
import { lintClickhouseTableOwnership } from "./persistence/clickhouse-table-ownership.ts";
import { lintMemoryTwinDrift } from "./persistence/memory-twin-drift.ts";
import { lintPrismaMigrationAccess } from "./persistence/prisma-migration-access.ts";
import { lintCommentBlockRoots } from "./quality/comment-blocks.ts";
import { lintComposedExports } from "./quality/composed-exports.ts";
import { lintStrictContractBuildConfigs } from "./quality/contract-build-config.ts";
import { lintDeclarationProjectReferences } from "./quality/declaration-project-references.ts";
import { lintDeclarations } from "./quality/declarations.ts";
import { lintInfrastructureMembers } from "./quality/infrastructure-member-unused.ts";
import { lintOxlintBaseline } from "./quality/oxlint-baseline-check.ts";
import { lintServiceCeilings } from "./quality/service-ceilings.ts";
import { lintServiceProjectionBoundaries } from "./quality/service-projection-boundaries.ts";
import { lintUnusedModuleExports } from "./quality/unused-module-export.ts";
import {
  lintCompositionRootMayOnlyShrink,
  lintMountFileIsOneCall,
  lintPortsAndAdaptersFolders,
  lintRestDoorWithoutMount,
} from "./shape-counters.ts";
import { lintSourceFolderShape } from "./source-folder-shape.ts";
import { lintTestQuality } from "./test-quality.ts";

/**
 * One registration for every policy: what it is called, the spec its
 * scenarios live in, the baseline file it ratchets against (if any), and how
 * to run it against a workspace snapshot. `lintSnapshot` in `index.ts` folds
 * this list and nothing else; the CLI does the same, so a library caller of
 * `lintWorkspace()` and `pnpm lint` see the same set of policies run.
 */
export type PolicyDefinition = {
  /** The registry's own name for the policy; usually its findings' `policy` field, kebab-cased from the `lint*` function. */
  id: string;
  /** The feature file its scenarios live in, repository-relative. */
  spec: string;
  /** The baseline JSON file it ratchets against, `src`-relative, or none. */
  baseline?: string;
  run: (snapshot: WorkspaceSnapshot) => ArchitectureViolation[];
};

export function definePolicy(policy: PolicyDefinition): PolicyDefinition {
  return policy;
}

const FEATURE_PACKAGE_BOUNDARIES = "specs/feature-package-boundaries.feature";
const STRICT_FEATURE_LAYOUT = "specs/strict-feature-layout.feature";
const LINT_BASELINES = "specs/lint-baselines.feature";
const DEAD_CODE_GUARDS = "specs/dead-code-guards.feature";

/** Prisma migration access needs the same schema read as table ownership; share it rather than re-parse. */
function lintPrismaMigrationAccessPolicy(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue } = snapshot;
  if (!hasPrismaSchema(root)) return [];

  return lintPrismaMigrationAccess(root, catalogue, new Set(prismaModelNames(root).keys()));
}

export const POLICIES: readonly PolicyDefinition[] = [
  definePolicy({
    id: "boundary-signature-mirrors",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintBoundarySignatureMirrors,
  }),
  definePolicy({
    id: "enterprise-source-license",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintEnterpriseSourceLicense,
  }),
  definePolicy({
    id: "feature-layout",
    spec: STRICT_FEATURE_LAYOUT,
    run: lintFeatureLayouts,
  }),
  definePolicy({
    id: "feature-app-contract",
    spec: STRICT_FEATURE_LAYOUT,
    run: lintFeatureAppContracts,
  }),
  definePolicy({
    id: "feature-setup-infrastructure",
    spec: STRICT_FEATURE_LAYOUT,
    run: lintFeatureSetupInfrastructure,
  }),
  definePolicy({
    id: "feature-shape",
    spec: STRICT_FEATURE_LAYOUT,
    baseline: "feature-shape-baseline.json",
    run: lintFeatureShape,
  }),
  definePolicy({
    id: "unused-module-export",
    spec: DEAD_CODE_GUARDS,
    baseline: "unused-module-export-baseline.json",
    run: lintUnusedModuleExports,
  }),
  definePolicy({
    id: "infrastructure-member-unused",
    spec: DEAD_CODE_GUARDS,
    baseline: "infrastructure-member-unused-baseline.json",
    run: lintInfrastructureMembers,
  }),
  definePolicy({
    id: "memory-twin-drift",
    spec: DEAD_CODE_GUARDS,
    baseline: "memory-twin-drift-baseline.json",
    run: lintMemoryTwinDrift,
  }),
  definePolicy({
    id: "source-folder-shape",
    spec: "specs/source-folder-shape.feature",
    baseline: "source-folder-shape-baseline.json",
    run: lintSourceFolderShape,
  }),
  definePolicy({
    id: "rest-door-without-mount",
    spec: LINT_BASELINES,
    baseline: "rest-door-without-mount-baseline.json",
    run: lintRestDoorWithoutMount,
  }),
  definePolicy({
    id: "ports-and-adapters-folders",
    spec: LINT_BASELINES,
    baseline: "ports-and-adapters-folders-baseline.json",
    run: lintPortsAndAdaptersFolders,
  }),
  definePolicy({
    id: "composition-root-may-only-shrink",
    spec: LINT_BASELINES,
    run: lintCompositionRootMayOnlyShrink,
  }),
  definePolicy({
    id: "mount-file-is-one-call",
    spec: LINT_BASELINES,
    baseline: "mount-file-is-one-call-baseline.json",
    run: lintMountFileIsOneCall,
  }),
  definePolicy({
    id: "feature-configuration",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintFeatureConfiguration,
  }),
  definePolicy({
    id: "prisma-table-ownership",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintPrismaTableOwnership,
  }),
  definePolicy({
    id: "clickhouse-table-ownership",
    spec: "specs/tooling/lint-clickhouse-table-ownership.feature",
    baseline: "clickhouse-table-ownership-baseline.json",
    run: lintClickhouseTableOwnership,
  }),
  definePolicy({
    id: "prisma-migration-access",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintPrismaMigrationAccessPolicy,
  }),
  definePolicy({
    id: "frontend-ui-boundaries",
    spec: "specs/frontend-feature-boundaries.feature",
    run: lintFrontendUiBoundaries,
  }),
  definePolicy({
    id: "global-app-access",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintGlobalAppAccess,
  }),
  definePolicy({
    id: "legacy-feature-fragments",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintLegacyFeatureFragments,
  }),
  definePolicy({
    id: "eventing-roles",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintEventingRoles,
  }),
  definePolicy({
    id: "architecture-records",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintArchitectureRecords,
  }),
  definePolicy({
    id: "contract-build-config",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintStrictContractBuildConfigs,
  }),
  definePolicy({
    id: "declaration-project-references",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintDeclarationProjectReferences,
  }),
  definePolicy({
    id: "port-modules",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintStrictPortModules,
  }),
  definePolicy({
    id: "manifests",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: (snapshot) => lintManifests(snapshot, declaredWebDependencyPairs(snapshot)),
  }),
  definePolicy({
    id: "application-boundaries",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: (snapshot) => lintApplicationBoundaries(snapshot),
  }),
  definePolicy({
    id: "api-transport-boundaries",
    spec: "specs/api-transport-through-framework.feature",
    run: lintApiTransportBoundaries,
  }),
  definePolicy({
    id: "api-transport-framework",
    spec: "specs/api-transport-through-framework.feature",
    run: lintApiTransportFramework,
  }),
  definePolicy({
    id: "service-projection-boundaries",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintServiceProjectionBoundaries,
  }),
  definePolicy({
    id: "service-ceilings",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintServiceCeilings,
  }),
  definePolicy({
    id: "cycles",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintCycles,
  }),
  definePolicy({
    id: "test-quality",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: (snapshot) => lintTestQuality(snapshot),
  }),
  definePolicy({
    id: "declarations",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintDeclarations,
  }),
  definePolicy({
    id: "composed-exports",
    spec: "specs/api-package-surface.feature",
    baseline: "composed-exports-baseline.json",
    run: lintComposedExports,
  }),
  definePolicy({
    id: "oxlint",
    spec: LINT_BASELINES,
    baseline: "oxlint-baseline.json",
    run: (snapshot) => lintOxlintBaseline(snapshot.root).violations,
  }),
  definePolicy({
    id: "comment-block-root",
    spec: LINT_BASELINES,
    baseline: "comment-block-roots.json",
    run: (snapshot) => lintCommentBlockRoots(snapshot.root).violations,
  }),
  definePolicy({
    id: "comment-block-review",
    spec: LINT_BASELINES,
    // The 4-5 line "review attention" tier never fails a run (A1); it is
    // registered so `--list-policies` names it, but a checked run reports no
    // violations for it — the CLI's `--review-comment-blocks` mode prints the
    // review queue itself, from `lintCommentBlocks`, which is not a finding list.
    run: () => [],
  }),
];
