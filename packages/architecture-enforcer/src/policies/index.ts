import type { ArchitectureViolation } from "../types.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";
import { lintApplicationBoundaries } from "./boundaries/application-boundaries.ts";
import { lintArchitectureRecords } from "./boundaries/architecture-records.ts";
import { lintCycles } from "./boundaries/cycles.ts";
import { lintFrameworkModuleContracts } from "./boundaries/framework-module-contracts.ts";
import { lintManifests } from "./boundaries/manifests.ts";
import { lintPeerCycles } from "./boundaries/peer-cycles.ts";
import { lintPlatformOperatorCalls } from "./boundaries/platform-operator-calls.ts";
import { lintFeatureConfiguration } from "./feature-configuration.ts";
import { lintFeatureLayouts } from "./feature-layout.ts";
import { lintFeatureShape } from "./feature-shape.ts";
import { lintBrowserNodeLeaks } from "./frontend/browser-node-leak.ts";
import {
  lintBrowserPackageClosure,
  lintBrowserPackageExports,
  lintBrowserPackageManifestClosure,
} from "./frontend/browser-packages.ts";
import { lintClickhouseTableOwnership } from "./persistence/clickhouse-table-ownership.ts";
import { lintEventingTableAccess } from "./persistence/eventing-table-access.ts";
import { lintMemoryTwinDrift } from "./persistence/memory-twin-drift.ts";
import { lintPrismaMigrationAccess } from "./persistence/prisma-migration-access.ts";
import {
  lintPrismaTableOwnership,
  prismaModelNames,
} from "./persistence/prisma-table-ownership.ts";
import { lintComposedExports } from "./quality/composed-exports.ts";
import { lintStrictContractBuildConfigs } from "./quality/contract-build-config.ts";
import { lintDeclarationProjectReferences } from "./quality/declaration-project-references.ts";
import { lintDeclarations } from "./quality/declarations.ts";
import { lintDefaultTestLanes } from "./quality/default-test-lane.ts";
import {
  lintDeletedSpellingsInCode,
  lintDeletedSpellingsInTeaching,
} from "./quality/deleted-spellings.ts";
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
    id: "declaration-project-references",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintDeclarationProjectReferences,
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
    id: "declarations",
    spec: FEATURE_PACKAGE_BOUNDARIES,
    run: lintDeclarations,
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
];
