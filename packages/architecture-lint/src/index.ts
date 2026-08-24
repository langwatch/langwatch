import { relative, resolve } from "node:path";
import { lintApplicationBoundaries } from "./application-boundaries";
import { lintArchitectureRecords } from "./architecture-records";
import { lintCycles } from "./cycles";
import { lintDeclarations } from "./declarations";
import { lintFeatureLayouts } from "./feature-layout";
import { lintManifests } from "./manifests";
import { lintPrismaBoundaries } from "./prisma-boundaries";
import type { ArchitectureViolation, LintWorkspaceOptions } from "./types";
import { discoverClassifiedPackages } from "./workspace";

export type {
  ApplicationPackageRole,
  ArchitectureViolation,
  ClassifiedPackage,
  EnterpriseCompositionRole,
  LintWorkspaceOptions,
  PackageKind,
} from "./types";
export type {
  LegacyApplicationBoundaryEdge,
  LegacyApplicationBoundaryKind,
} from "./application-boundaries";
export {
  collectLegacyApplicationBoundaryEdges,
  formatLegacyApplicationBoundaryBaseline,
} from "./application-boundaries";
export { discoverClassifiedPackages } from "./workspace";

export function lintWorkspace(
  options: LintWorkspaceOptions,
): ArchitectureViolation[] {
  const root = resolve(options.root);
  const discovery = discoverClassifiedPackages(root);
  const violations = [
    ...discovery.violations,
    ...lintFeatureLayouts(discovery.packages),
    ...lintArchitectureRecords(discovery.packages),
    ...lintManifests(discovery.packages),
    ...lintApplicationBoundaries(root, discovery.packages),
    ...lintPrismaBoundaries(discovery.packages),
    ...lintCycles(discovery.packages),
    ...(options.declarations === false
      ? []
      : lintDeclarations(discovery.packages)),
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
