#!/usr/bin/env tsx
import { relative, resolve } from "node:path";
import {
  formatViolation,
  changedSourceFiles,
  discoverClassifiedPackages,
  lintCommentBlocks,
  lintServiceQuality,
  lintServiceQualityBaseline,
  lintStrictPortModules,
  lintStrictPortBaseline,
  lintTestQuality,
  lintWorkspace,
} from "./index";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? void 0 : process.argv[index + 1];
}

const root = resolve(valueAfter("--root") ?? process.cwd());
const serviceQualityBaselineReference = valueAfter(
  "--service-quality-baseline-reference",
);
const baselineReferenceDirectory = valueAfter("--baseline-reference-dir");
const portModuleBaselineReference =
  valueAfter("--port-module-baseline-reference") ??
  (baselineReferenceDirectory
    ? `${baselineReferenceDirectory}/port-module-baseline.json`
    : void 0);
const resolvedServiceQualityBaselineReference =
  serviceQualityBaselineReference ??
  (baselineReferenceDirectory
    ? `${baselineReferenceDirectory}/service-quality-baseline.json`
    : void 0);
const baselineOnly =
  process.argv.includes("--shrinking-baseline-only") ||
  process.argv.includes("--service-quality-baseline-only");
const baselineCheck = baselineOnly
  ? {
      serviceQuality: lintServiceQualityBaseline(
        root,
        resolvedServiceQualityBaselineReference,
      ),
      strictPorts: lintStrictPortBaseline(root, portModuleBaselineReference),
    }
  : void 0;
const baselineDiscovery = baselineOnly ? discoverClassifiedPackages(root) : void 0;
const baselinePolicyViolations =
  baselineCheck && baselineDiscovery
    ? [
        ...baselineCheck.serviceQuality.violations,
        ...baselineCheck.strictPorts.violations,
        ...lintServiceQuality(root, baselineDiscovery.packages),
        ...lintStrictPortModules(root, baselineDiscovery.packages),
      ]
    : void 0;
const reviewCommentBlocks = process.argv.includes("--review-comment-blocks");
const reviewTestQuality = process.argv.includes("--review-test-quality");
const changedFiles = changedSourceFiles(root);
const commentBlocks = lintCommentBlocks(root, {
  files: process.argv.includes("--all-comment-blocks") ? void 0 : changedFiles,
});
const violations = reviewCommentBlocks
  ? commentBlocks.violations
  : reviewTestQuality
    ? lintTestQuality(root, { files: changedFiles })
    : baselinePolicyViolations
      ? baselinePolicyViolations
      : lintWorkspace(
          {
            root,
            changedFiles,
            declarations: !process.argv.includes("--no-declarations"),
            legacyApplicationMigration: !process.argv.includes(
              "--no-legacy-application-migration",
            ),
            legacyFeatureFragments: !process.argv.includes(
              "--no-legacy-feature-fragments",
            ),
            serviceQualityBaselineReference: resolvedServiceQualityBaselineReference,
          },
          commentBlocks,
        );

if (reviewCommentBlocks && commentBlocks.reviews.length > 0) {
  process.stdout.write(
    `architecture-lint: comment-block review queue\n${commentBlocks.reviews
      .map(
        (review) =>
          `[${review.category}] ${review.file}:${review.line}\n  ${review.message}`,
      )
      .join("\n\n")}\n`,
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
