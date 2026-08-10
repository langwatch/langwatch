#!/usr/bin/env node
/**
 * Every checkout in the heavy workflows leaves the marketing media behind.
 *
 * docs/media, docs/images and assets/ are 165 MB of .gif and .mp4 against
 * 81 MB for platform/, the thing CI builds. Naming a sparse-checkout makes
 * actions/checkout fetch with `--filter=blob:none`, so those blobs never
 * transfer: a depth-1 clone goes from 180 MB to 42 MB of .git.
 *
 * This is a guard rather than a one-off edit because the failure mode is a
 * new job added without the exclusion. Nothing breaks; CI just quietly gets
 * slower again, one job at a time, until somebody re-measures a checkout.
 *
 * It excludes the MEDIA, not docs/ wholesale, and the distinction is load
 * bearing: error-remediation.unit.test.ts resolves the repo's docs/ and
 * asserts every remediation link maps to a real .mdx, so dropping all of
 * docs/ fails three test-unit shards. The .mdx tree is ~10 MB of docs/'s
 * 138; the media is the other 128 and nothing in CI reads it.
 *
 * Line-scanned rather than YAML-parsed for the same reason
 * guard-pull-request-target.ts is: these guards run on a bare runner with
 * `node --test --experimental-strip-types` and no pnpm install, so there is
 * no YAML library to reach for.
 *
 * @see specs/ci/lean-checkout.feature
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Workflows whose jobs check out the working tree to build or test the app. */
export const GUARDED_WORKFLOWS = [
  ".github/workflows/langwatch-app-ci.yml",
  ".github/workflows/e2e-ci.yml",
];

/**
 * Root-anchored on purpose. A bare `assets` pattern would also drop
 * services/langyagent/internal/assets, which
 * shipped-evaluator-types.unit.test.ts reads.
 */
export const REQUIRED_EXCLUSIONS = ["/docs/media/", "/docs/images/", "/assets/"];

export type CheckoutStep = {
  workflow: string;
  job: string;
  line: number;
  /** The `with:` mapping keys and values, one entry per line. */
  body: string[];
};

const stripYamlComment = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.startsWith("#")) {
    return "";
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Collect every `uses: actions/checkout@...` step with the lines that belong
 * to it — everything up to the next line at or below the step's own indent
 * that starts a new list item or key.
 */
export const checkoutSteps = (
  workflow: string,
  lines: string[],
): CheckoutStep[] => {
  const steps: CheckoutStep[] = [];
  let job = "(unknown)";

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? "";
    const line = stripYamlComment(raw);

    const jobMatch = /^(\s{2})["']?([A-Za-z0-9_-]+)["']?:\s*$/.exec(raw);
    if (jobMatch?.[2]) {
      job = jobMatch[2];
      continue;
    }

    if (!/^-?\s*uses:\s*actions\/checkout@/.test(line)) {
      continue;
    }

    const stepIndent = indentOf(raw.replace(/^(\s*)-\s/, "$1  "));
    const body: string[] = [];

    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const next = lines[cursor] ?? "";
      if (next.trim() === "") {
        continue;
      }
      // A new step, or the end of this job's step list.
      if (indentOf(next) < stepIndent || /^\s*-\s/.test(next)) {
        break;
      }
      body.push(stripYamlComment(next));
    }

    steps.push({ workflow, job, line: index + 1, body });
  }

  return steps;
};

/** A gate job reads nothing outside .github, so it takes only that. */
export const isGateOnly = (step: CheckoutStep): boolean =>
  step.body.some((line) => /^sparse-checkout:\s*\.github\s*$/.test(line));

const sparsePatterns = (step: CheckoutStep): string[] => {
  const start = step.body.findIndex((line) =>
    /^sparse-checkout:\s*\|/.test(line),
  );
  if (start === -1) {
    return [];
  }

  const patterns: string[] = [];
  for (let index = start + 1; index < step.body.length; index++) {
    const line = step.body[index] ?? "";
    if (/^[a-z-]+:/.test(line)) {
      break;
    }
    if (line !== "") {
      patterns.push(line);
    }
  }

  return patterns;
};

const conePattern = /^sparse-checkout-cone-mode:\s*false\s*$/;

export const violations = (steps: CheckoutStep[]): string[] => {
  const problems: string[] = [];

  for (const step of steps) {
    const where = `${step.workflow}:${step.line} job "${step.job}"`;
    if (isGateOnly(step)) {
      continue;
    }

    const patterns = sparsePatterns(step);
    if (patterns.length === 0) {
      problems.push(
        `${where} declares no sparse-checkout, so it pulls the media too`,
      );
      continue;
    }

    if (patterns.includes("!/docs/")) {
      problems.push(
        `${where} drops docs/ wholesale, which fails error-remediation.unit.test.ts — exclude the media beneath it instead`,
      );
    }

    for (const exclusion of REQUIRED_EXCLUSIONS) {
      if (!patterns.includes(`!${exclusion}`)) {
        problems.push(`${where} does not exclude ${exclusion}`);
      }
    }

    for (const pattern of patterns.filter((p) => p.startsWith("!"))) {
      if (!pattern.startsWith("!/")) {
        problems.push(
          `${where} has an unanchored exclusion "${pattern}", which would also match nested directories of that name`,
        );
      }
    }

    if (!step.body.some((line) => conePattern.test(line))) {
      problems.push(
        `${where} negates paths without sparse-checkout-cone-mode: false, and cone mode does not honour negation`,
      );
    }
  }

  return problems;
};

export const run = (repoRoot: string): string[] =>
  violations(
    GUARDED_WORKFLOWS.flatMap((workflow) =>
      checkoutSteps(
        workflow,
        readFileSync(resolve(repoRoot, workflow), "utf8").split(/\r?\n/),
      ),
    ),
  );

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = run(process.argv[2] ?? ".");
  if (problems.length > 0) {
    console.error("Lean-checkout guard failed:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    console.error("\nSee specs/ci/lean-checkout.feature");
    process.exit(1);
  }
  console.log("Lean-checkout guard passed.");
}
