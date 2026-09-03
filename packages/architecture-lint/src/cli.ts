#!/usr/bin/env tsx
import { relative, resolve } from "node:path";
import {
  formatViolation,
  boundaryEdgesFromViolations,
  changedSourceFiles,
  discoverClassifiedPackages,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
  lintCommentBlocks,
  lintCommentBlockRoots,
  lintFeatureLayouts,
  lintManifests,
  lintServiceQuality,
  lintServiceQualityBaseline,
  lintStrictPortModules,
  lintStrictPortBaseline,
  lintTestQuality,
  lintWorkspace,
  type ArchitectureViolation,
} from "./index";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? void 0 : process.argv[index + 1];
}

const root = resolve(valueAfter("--root") ?? process.cwd());
const serviceQualityBaselineReference = valueAfter("--service-quality-baseline-reference");
const baselineReferenceDirectory = valueAfter("--baseline-reference-dir");
const portModuleBaselineReference =
  valueAfter("--port-module-baseline-reference") ??
  (baselineReferenceDirectory ? `${baselineReferenceDirectory}/port-module-baseline.json` : void 0);
const resolvedServiceQualityBaselineReference =
  serviceQualityBaselineReference ??
  (baselineReferenceDirectory
    ? `${baselineReferenceDirectory}/service-quality-baseline.json`
    : void 0);
const commentBlockRootsBaselineReference =
  valueAfter("--comment-block-roots-reference") ??
  (baselineReferenceDirectory ? `${baselineReferenceDirectory}/comment-block-roots.json` : void 0);
const boundaryEdgeBaselineReference =
  valueAfter("--boundary-edge-baseline-reference") ??
  (baselineReferenceDirectory
    ? `${baselineReferenceDirectory}/boundary-edge-baseline.json`
    : void 0);
const commentBlockRoots = lintCommentBlockRoots(root, commentBlockRootsBaselineReference);
const baselineOnly =
  process.argv.includes("--shrinking-baseline-only") ||
  process.argv.includes("--service-quality-baseline-only");
const baselineDiscovery = baselineOnly ? discoverClassifiedPackages(root) : void 0;
// `lintManifests`/`lintFeatureLayouts` run outside `lintWorkspace` here, so
// their violations still carry absolute file paths — relativize before
// deriving edges, which are keyed by the workspace-relative `from`.
const baselineBoundaryEdges = baselineDiscovery
  ? boundaryEdgesFromViolations(
      [
        ...lintManifests(baselineDiscovery.packages),
        ...lintFeatureLayouts(root, baselineDiscovery.packages, baselineDiscovery.catalogue),
      ].map((violation) => ({ ...violation, file: relative(root, violation.file) })),
    )
  : [];
const baselineCheck = baselineOnly
  ? {
      serviceQuality: lintServiceQualityBaseline(root, resolvedServiceQualityBaselineReference),
      strictPorts: lintStrictPortBaseline(root, portModuleBaselineReference),
      boundaryEdges: lintBoundaryEdgeBaseline(
        root,
        baselineBoundaryEdges,
        boundaryEdgeBaselineReference,
      ),
      commentBlockRoots,
    }
  : void 0;
const baselinePolicyViolations =
  baselineCheck && baselineDiscovery
    ? [
        ...baselineCheck.serviceQuality.violations,
        ...baselineCheck.strictPorts.violations,
        ...baselineCheck.boundaryEdges.violations,
        ...baselineCheck.commentBlockRoots.violations,
        ...lintServiceQuality(root, baselineDiscovery.packages),
        ...lintStrictPortModules(root, baselineDiscovery.packages),
      ]
    : void 0;
const reviewCommentBlocks = process.argv.includes("--review-comment-blocks");
const reviewTestQuality = process.argv.includes("--review-test-quality");
const changedFiles = changedSourceFiles(root);
const allCommentBlocks = process.argv.includes("--all-comment-blocks");
const commentBlocks = allCommentBlocks
  ? lintCommentBlocks(root, { files: void 0 })
  : lintCommentBlocks(root, { changedFiles, allowedRoots: commentBlockRoots.entries });

function fullWorkspaceViolations(): ArchitectureViolation[] {
  const workspaceViolations = lintWorkspace(
    {
      root,
      changedFiles,
      declarations: !process.argv.includes("--no-declarations"),
      legacyApplicationMigration: !process.argv.includes("--no-legacy-application-migration"),
      legacyFeatureFragments: !process.argv.includes("--no-legacy-feature-fragments"),
      serviceQualityBaselineReference: resolvedServiceQualityBaselineReference,
    },
    commentBlocks,
  );
  // `lintWorkspace` already relativized `file`, so its cross-feature/private-runtime-export
  // violations are the current edges as-is.
  const boundaryEdges = lintBoundaryEdgeBaseline(
    root,
    boundaryEdgesFromViolations(workspaceViolations),
    boundaryEdgeBaselineReference,
  );
  return [
    ...filterBaselinedBoundaryEdges(workspaceViolations, boundaryEdges.entries),
    ...commentBlockRoots.violations,
    ...boundaryEdges.violations,
  ];
}

const violations = reviewCommentBlocks
  ? commentBlocks.violations
  : reviewTestQuality
    ? lintTestQuality(root, { files: changedFiles })
    : baselinePolicyViolations
      ? baselinePolicyViolations
      : fullWorkspaceViolations();

if (reviewCommentBlocks && commentBlocks.reviews.length > 0) {
  process.stdout.write(
    `architecture-lint: comment-block review queue\n${commentBlocks.reviews
      .map((review) => `[${review.category}] ${review.file}:${review.line}\n  ${review.message}`)
      .join("\n\n")}\n`,
  );
}

// The 4-5 line warn tier is visible on every run, not only under
// --review-comment-blocks: this is how a block gets a second look at review
// time without a whole-repo listing (R1). It never changes the exit code.
if (!reviewCommentBlocks && !reviewTestQuality && commentBlocks.reviews.length > 0) {
  process.stderr.write(
    `architecture-lint: comment-block review\n${commentBlocks.reviews
      .map((review) => `[${review.category}] ${review.file}:${review.line}\n  ${review.message}`)
      .join("\n\n")}\n\n`,
  );
}

if (violations.length === 0) {
  if (reviewCommentBlocks || reviewTestQuality) {
    const review = reviewCommentBlocks ? "comment-block" : "test-quality";
    process.stdout.write(`architecture-lint: ${review} review complete\n`);
  } else {
    if (baselineCheck?.serviceQuality.bootstrapped) {
      process.stdout.write(
        "architecture-lint: accepting the one-time service quality baseline bootstrap; future merge-base checks can only shrink it\n",
      );
    }
    if (baselineCheck?.strictPorts.bootstrapped) {
      process.stdout.write(
        "architecture-lint: accepting the one-time strict port baseline bootstrap; future merge-base checks can only shrink it\n",
      );
    }
    if (baselineCheck?.boundaryEdges.bootstrapped) {
      process.stdout.write(
        "architecture-lint: accepting the one-time boundary edge baseline bootstrap; future merge-base checks can only shrink it\n",
      );
    }
    process.stdout.write("architecture-lint: package boundaries are sealed\n");
  }
} else {
  const displayViolations =
    reviewCommentBlocks || reviewTestQuality
      ? violations.map((violation) => ({
          ...violation,
          file: relative(root, violation.file) || violation.file,
        }))
      : violations;
  process.stderr.write(`${displayViolations.map(formatViolation).join("\n\n")}\n`);
  process.exitCode = 1;
}
