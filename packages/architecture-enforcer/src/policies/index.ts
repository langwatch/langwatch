import type { ArchitectureViolation } from "../types.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";
import { lintApplicationBoundaries } from "./boundaries/application-boundaries.ts";
import { lintArchitectureRecords } from "./boundaries/architecture-records.ts";
import { lintContractTuningConstants } from "./boundaries/contract-tuning-constant.ts";
import { lintCycles } from "./boundaries/cycles.ts";
import { lintErrorCodeSingleOwner } from "./boundaries/error-code-single-owner.ts";
import { lintForeignErrorCodes } from "./boundaries/foreign-error-code.ts";
import { lintFrameworkModuleContracts } from "./boundaries/framework-module-contracts.ts";
import { lintManifests } from "./boundaries/manifests.ts";
import { lintOwnerOnlyConstants } from "./boundaries/owner-only-constant.ts";
import { lintPeerApiFanIn } from "./boundaries/peer-api-fan-in.ts";
import { lintPeerCycles } from "./boundaries/peer-cycles.ts";
import { lintPeerFeatureDirectory } from "./boundaries/peer-feature-directory.ts";
import { lintPlatformOperatorCalls } from "./boundaries/platform-operator-calls.ts";
import { lintRestNamespaceOwners } from "./boundaries/rest-namespace-owners.ts";
import { lintRuntimeDevDependency } from "./boundaries/runtime-dev-dependency.ts";
import { lintFeatureConfiguration } from "./feature-configuration.ts";
import { lintFeatureLayouts } from "./feature-layout.ts";
import { lintFeatureShape } from "./feature-shape.ts";
import { lintBrowserNodeLeaks } from "./frontend/browser-node-leak.ts";
import {
  lintBrowserPackageClosure,
  lintBrowserPackageExports,
  lintBrowserPackageManifestClosure,
} from "./frontend/browser-packages.ts";
import { lintBrowserTimingWorkarounds } from "./frontend/browser-timing-workaround.ts";
import { lintDesignSystemRecomposition } from "./frontend/design-system-recomposition.ts";
import { lintRawColours } from "./frontend/raw-colour.ts";
import { lintClickhouseTableOwnership } from "./persistence/clickhouse-table-ownership.ts";
import { lintEventingTableAccess } from "./persistence/eventing-table-access.ts";
import { lintIdIndexBounds } from "./persistence/id-index-bounds.ts";
import { lintIdIndexPairing } from "./persistence/id-index-pairing.ts";
import { lintMemoryTwinDrift } from "./persistence/memory-twin-drift.ts";
import { lintMigrationOwners } from "./persistence/migration-owners.ts";
import { lintPrismaMigrationAccess } from "./persistence/prisma-migration-access.ts";
import { lintPrismaModelOwnership } from "./persistence/prisma-model-ownership.ts";
import {
  lintPrismaTableOwnership,
  prismaModelNames,
} from "./persistence/prisma-table-ownership.ts";
import { lintRerunnableMigrations } from "./persistence/rerunnable-migrations.ts";
import { lintUpgradeSignInTables } from "./persistence/upgrade-sign-in-tables.ts";
import { lintAdrNumberUniqueness } from "./quality/adr-number-unique.ts";
import { lintCodeCatchToNull } from "./quality/code-catch-to-null.ts";
import { lintComposedExports } from "./quality/composed-exports.ts";
import { lintStrictContractBuildConfigs } from "./quality/contract-build-config.ts";
import { lintDeadPathCitations } from "./quality/dead-path-citations.ts";
import { lintDeclarations } from "./quality/declarations.ts";
import { lintDefaultTestLanes } from "./quality/default-test-lane.ts";
import {
  lintDeletedSpellingsInCode,
  lintDeletedSpellingsInTeaching,
} from "./quality/deleted-spellings.ts";
import { lintDependencyCatalog } from "./quality/dependency-catalog.ts";
import { lintDuplicatesAcrossModules } from "./quality/duplicate-across-modules.ts";
import { lintHandledErrorSentenceCopy } from "./quality/handled-error-sentence-copy.ts";
import { lintMetricInstrumentHome } from "./quality/metric-instrument-home.ts";
import { lintPeerRouteLiterals } from "./quality/peer-route-literal.ts";
import { lintRestatedContractConstants } from "./quality/restated-contract-constant.ts";
import { lintServiceCeilings } from "./quality/service-ceilings.ts";
import { lintServiceProjectionBoundaries } from "./quality/service-projection-boundaries.ts";
import { lintLintRuleSkillPointers, lintTeachingCitations } from "./quality/teaching-citations.ts";
import { lintUnusedModuleExports } from "./quality/unused-module-export.ts";
import { lintWorkspaceSeams } from "./quality/workspace-seams.ts";
import { lintSourceFolderShape } from "./source-folder-shape.ts";

/**
 * One registration per policy: what it is called, the spec its scenarios live
 * in, and how to run it. Both `lintSnapshot` and the CLI fold this same list.
 */
export type PolicyDefinition = {
  /** The registry's own name for the policy; usually kebab-cased from the `lint*` function. */
  id: string;
  /** The feature file its scenarios live in, repository-relative. */
  spec: string;
  run: (snapshot: WorkspaceSnapshot) => ArchitectureViolation[];
};

export function definePolicy(policy: PolicyDefinition): PolicyDefinition {
  return policy;
}

const FEATURE_PACKAGE_BOUNDARIES = "specs/feature-package-boundaries.feature";
const STRICT_FEATURE_LAYOUT = "specs/strict-feature-layout.feature";
const DEAD_CODE_GUARDS = "specs/dead-code-guards.feature";
const DELETED_SPELLINGS = "specs/tooling/lint-deleted-spellings.feature";

/** Prisma migration access reads the same schema models table ownership does. */
function lintPrismaMigrationAccessPolicy(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue } = snapshot;
  const models = prismaModelNames({ root, policy: "prisma-migration-access" });

  return lintPrismaMigrationAccess(root, catalogue, new Set(models.keys()));
}

/** The closed browser package at both levels: each import once, each manifest edge once. */
function lintBrowserPackageClosurePolicy(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return [...lintBrowserPackageClosure(snapshot), ...lintBrowserPackageManifestClosure(snapshot)];
}

const DESIGN_SYSTEM_USE = "specs/design-system-use.feature";
const LITERAL_OWNERSHIP = "specs/literal-ownership.feature";
const CODE_CATCH_TO_NULL = "specs/code-catch-to-null.feature";
const HANDLED_ERROR_SENTENCE_COPY = "specs/handled-error-sentence-copy.feature";
const MODULE_OWNERSHIP = "specs/module-ownership.feature";
const CONTRACT_EXPORT_VISIBILITY = "specs/contract-export-visibility.feature";
const RUNTIME_DEV_DEPENDENCY = "specs/tooling/lint-runtime-dev-dependency.feature";

export const POLICIES: readonly PolicyDefinition[] = [
  definePolicy({
    id: "feature-layout",
    spec: STRICT_FEATURE_LAYOUT,
    run: lintFeatureLayouts,
  }),
  definePolicy({
    id: "feature-shape",
    spec: STRICT_FEATURE_LAYOUT,
    run: lintFeatureShape,
  }),
  definePolicy({
    id: "unused-module-export",
    spec: DEAD_CODE_GUARDS,
    run: lintUnusedModuleExports,
  }),
  definePolicy({
    id: "memory-twin-drift",
    spec: DEAD_CODE_GUARDS,
    run: lintMemoryTwinDrift,
  }),
  definePolicy({
    id: "source-folder-shape",
    spec: "specs/source-folder-shape.feature",
    run: lintSourceFolderShape,
  }),
  definePolicy({
    id: "feature-configuration",
    spec: "specs/tooling/lint-feature-configuration.feature",
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
    run: lintClickhouseTableOwnership,
  }),
  definePolicy({
    id: "migration-owners",
    spec: "specs/migration-owners.feature",
    run: lintMigrationOwners,
  }),
  definePolicy({
    id: "upgrade-sign-in-tables",
    spec: "specs/upgrade-sign-in-tables.feature",
    run: lintUpgradeSignInTables,
  }),
  definePolicy({
    id: "rerunnable-migrations",
    spec: "specs/rerunnable-migrations.feature",
    run: lintRerunnableMigrations,
  }),
  definePolicy({
    id: "prisma-migration-access",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintPrismaMigrationAccessPolicy,
  }),
  definePolicy({
    id: "browser-node-leak",
    spec: "specs/tooling/lint-browser-node-leak.feature",
    run: lintBrowserNodeLeaks,
  }),
  definePolicy({
    id: "browser-package-closure",
    spec: "specs/frontend-feature-boundaries.feature",
    run: lintBrowserPackageClosurePolicy,
  }),
  definePolicy({
    id: "browser-package-exports",
    spec: "specs/frontend-feature-boundaries.feature",
    run: lintBrowserPackageExports,
  }),
  definePolicy({
    id: "architecture-records",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintArchitectureRecords,
  }),
  definePolicy({
    id: "default-test-lane",
    spec: "specs/tooling/default-test-lane.feature",
    run: lintDefaultTestLanes,
  }),
  definePolicy({
    id: "contract-build-config",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintStrictContractBuildConfigs,
  }),
  definePolicy({
    id: "manifests",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintManifests,
  }),
  definePolicy({
    id: "application-boundaries",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintApplicationBoundaries,
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
    id: "peer-cycles",
    spec: "specs/peer-cycles.feature",
    run: lintPeerCycles,
  }),
  definePolicy({
    id: "platform-operator-calls",
    spec: "specs/tooling/lint-platform-operator-calls.feature",
    run: lintPlatformOperatorCalls,
  }),
  definePolicy({
    id: "rest-namespace-owners",
    spec: "specs/rest-namespace-owners.feature",
    run: lintRestNamespaceOwners,
  }),
  definePolicy({
    id: "framework-module-contracts",
    spec: "specs/framework-module-contracts.feature",
    run: lintFrameworkModuleContracts,
  }),
  definePolicy({
    id: "eventing-table-access",
    spec: "specs/eventing-table-access.feature",
    run: lintEventingTableAccess,
  }),
  definePolicy({
    id: "id-index-pairing",
    spec: "specs/tooling/lint-id-index-policies.feature",
    run: lintIdIndexPairing,
  }),
  definePolicy({
    id: "id-index-bounds",
    spec: "specs/tooling/lint-id-index-policies.feature",
    run: lintIdIndexBounds,
  }),
  definePolicy({
    id: "declarations",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintDeclarations,
  }),
  definePolicy({
    id: "dependency-catalog",
    spec: "specs/dependency-catalog.feature",
    run: lintDependencyCatalog,
  }),
  definePolicy({
    id: "workspace-seams",
    spec: "specs/workspace-seams.feature",
    run: lintWorkspaceSeams,
  }),
  definePolicy({
    id: "deleted-spellings-in-teaching",
    spec: DELETED_SPELLINGS,
    run: lintDeletedSpellingsInTeaching,
  }),
  definePolicy({
    id: "deleted-spellings-in-code",
    spec: DELETED_SPELLINGS,
    run: lintDeletedSpellingsInCode,
  }),
  definePolicy({
    id: "composed-exports",
    spec: "specs/api-package-surface.feature",
    run: lintComposedExports,
  }),
  definePolicy({
    id: "teaching-citations",
    spec: "specs/tooling/lint-teaching-citations.feature",
    run: lintTeachingCitations,
  }),
  definePolicy({
    id: "lint-rule-skill-pointers",
    spec: "specs/tooling/lint-teaching-citations.feature",
    run: lintLintRuleSkillPointers,
  }),
  definePolicy({
    id: "dead-path-citations",
    spec: "specs/tooling/lint-teaching-citations.feature",
    run: lintDeadPathCitations,
  }),
  definePolicy({ id: "raw-colour", spec: DESIGN_SYSTEM_USE, run: lintRawColours }),
  definePolicy({
    id: "design-system-recomposition",
    spec: DESIGN_SYSTEM_USE,
    run: lintDesignSystemRecomposition,
  }),
  definePolicy({
    id: "browser-timing-workaround",
    spec: DESIGN_SYSTEM_USE,
    run: lintBrowserTimingWorkarounds,
  }),
  definePolicy({
    id: "metric-instrument-home",
    spec: "specs/tooling/lint-metric-instrument-home.feature",
    run: lintMetricInstrumentHome,
  }),
  definePolicy({ id: "peer-route-literal", spec: LITERAL_OWNERSHIP, run: lintPeerRouteLiterals }),
  definePolicy({
    id: "duplicate-across-modules",
    spec: LITERAL_OWNERSHIP,
    run: lintDuplicatesAcrossModules,
  }),
  definePolicy({ id: "adr-number-unique", spec: LITERAL_OWNERSHIP, run: lintAdrNumberUniqueness }),
  definePolicy({
    id: "restated-contract-constant",
    spec: LITERAL_OWNERSHIP,
    run: lintRestatedContractConstants,
  }),
  definePolicy({
    id: "owner-only-constant",
    spec: CONTRACT_EXPORT_VISIBILITY,
    run: lintOwnerOnlyConstants,
  }),
  definePolicy({
    id: "contract-tuning-constant",
    spec: CONTRACT_EXPORT_VISIBILITY,
    run: lintContractTuningConstants,
  }),
  definePolicy({
    id: "runtime-dev-dependency",
    spec: RUNTIME_DEV_DEPENDENCY,
    run: lintRuntimeDevDependency,
  }),
  definePolicy({
    id: "handled-error-sentence-copy",
    spec: HANDLED_ERROR_SENTENCE_COPY,
    run: lintHandledErrorSentenceCopy,
  }),
  definePolicy({ id: "code-catch-to-null", spec: CODE_CATCH_TO_NULL, run: lintCodeCatchToNull }),
  definePolicy({
    id: "prisma-model-ownership",
    spec: MODULE_OWNERSHIP,
    run: lintPrismaModelOwnership,
  }),
  definePolicy({
    id: "peer-feature-directory",
    spec: MODULE_OWNERSHIP,
    run: lintPeerFeatureDirectory,
  }),
  definePolicy({
    id: "error-code-single-owner",
    spec: MODULE_OWNERSHIP,
    run: lintErrorCodeSingleOwner,
  }),
  definePolicy({ id: "peer-api-fan-in", spec: MODULE_OWNERSHIP, run: lintPeerApiFanIn }),
  definePolicy({
    id: "foreign-error-code",
    spec: "specs/foreign-error-code.feature",
    run: lintForeignErrorCodes,
  }),
];
